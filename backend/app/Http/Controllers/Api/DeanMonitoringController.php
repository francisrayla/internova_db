<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Models\Attendance;
use App\Models\DailyActivity;
use App\Models\DeanFeedback;
use App\Models\Document;
use App\Models\Evaluation;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\NarrativeTemplate;
use App\Models\School;
use App\Models\Task;
use App\Models\User;
use App\Services\ActivityLogService;
use App\Services\DeploymentSummaryService;
use App\Services\NarrativeProgressService;
use App\Services\NarrativeReportService;
use App\Services\NotificationService;
use App\Services\SchoolStaff;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Read-only monitoring for the school's Dean: how the coordinator is doing
 * (activity, pending work, feedback) and how the interns are doing. Every
 * query is scoped to the dean's own school_id; other schools' ids are 404.
 * Business logic is shared with the coordinator side (DeploymentSummaryService,
 * NarrativeReportService, NarrativeProgressService).
 */
class DeanMonitoringController extends Controller
{
    // Alert / flag thresholds (documented in the dean feature log).
    public const STALE_DOCUMENT_DAYS = 3;       // pending review longer than this = neglected
    public const NO_CLOCK_IN_WORKING_DAYS = 3;  // completed working days without a clock-in
    public const BEHIND_POINTS = 20;            // hours% this far under time-elapsed%
    public const BEHIND_MIN_ELAPSED = 15;       // ...only once this much of the deployment has passed
    public const COORDINATOR_QUIET_DAYS = 3;
    public const INVITE_STALE_DAYS = 3;
    public const EVALUATION_WINDOW_DAYS = 14;   // evaluation due when the deployment ends within this
    public const SUBSCRIPTION_WARN_DAYS = 14;

    private function schoolOf(Request $request): School
    {
        return School::findOrFail($request->user()->school_id);
    }

    private function nameOf(?User $u): ?string
    {
        return $u ? (trim("{$u->first_name} {$u->last_name}") ?: $u->name) : null;
    }

    private function currentCoordinator(int $schoolId): ?User
    {
        $roleId = SchoolStaff::roleId('coordinator');

        return SchoolStaff::coordinator($schoolId)
            ?? User::where('school_id', $schoolId)->where('role_id', $roleId)->latest('id')->first();
    }

    private function deployment(Request $request, int $id): ?InternshipDeployment
    {
        return InternshipDeployment::with(['intern', 'company', 'supervisor'])
            ->where('id', $id)->where('school_id', $request->user()->school_id)->first();
    }

    private static function notFound(string $what = 'Intern'): JsonResponse
    {
        return response()->json(['success' => false, 'message' => "{$what} not found."], 404);
    }

    private static function plural(int $n, string $one, string $many): string
    {
        return $n === 1 ? $one : $many;
    }

    private static function daysText(int $n): string
    {
        return $n . ' ' . self::plural($n, 'day', 'days');
    }

    // ---------------------------------------------------------------
    // Coordinator info
    // ---------------------------------------------------------------

    /** Latest of: last login, token use, last recorded action. */
    private function lastActive(User $coordinator): ?Carbon
    {
        $times = array_filter([
            $coordinator->last_login_at,
            ($t = $coordinator->tokens()->max('last_used_at')) ? Carbon::parse($t) : null,
            ($t = ActivityLog::where('user_id', $coordinator->id)->max('created_at')) ? Carbon::parse($t) : null,
        ]);

        return $times ? collect($times)->max() : null;
    }

    private function coordinatorBrief(?User $c, int $pendingCount = 0): ?array
    {
        if (!$c) {
            return null;
        }
        $last = $this->lastActive($c);

        return [
            'id' => $c->id,
            'name' => $this->nameOf($c),
            'email' => $c->email,
            'avatar_url' => $c->avatar_url,
            'status' => SchoolStaff::accountState($c),
            'member_since' => $c->created_at?->toIso8601String(),
            'last_active_at' => $last?->toIso8601String(),
            'activities_this_week' => ActivityLog::where('user_id', $c->id)->where('created_at', '>=', now()->subDays(7))->count(),
            'pending_count' => $pendingCount,
            'invitation_expired' => $c->status === 'pending_activation' && $c->invitation_expires_at !== null && Carbon::parse($c->invitation_expires_at)->isPast(),
            'email_bounced' => $c->email_bounced_at !== null,
        ];
    }

    // ---------------------------------------------------------------
    // Intern rows (one fixed set of queries for the whole school)
    // ---------------------------------------------------------------

    /** Working days (Mon-Fri) strictly after $after and strictly before $before. */
    private static function workingDaysBetween(Carbon $after, Carbon $before): int
    {
        $n = 0;
        for ($d = $after->copy()->startOfDay()->addDay(); $d->lt($before->copy()->startOfDay()); $d->addDay()) {
            if ($d->isWeekday()) {
                $n++;
            }
        }

        return $n;
    }

    /** @return Collection<int, array> */
    private function internRows(School $school): Collection
    {
        $deployments = InternshipDeployment::with(['intern', 'company', 'supervisor'])
            ->where('school_id', $school->id)->orderByDesc('id')->get();
        if ($deployments->isEmpty()) {
            return collect();
        }
        $ids = $deployments->pluck('id')->all();
        $profiles = InternProfile::where('school_id', $school->id)->get()->keyBy('user_id');

        $attendance = Attendance::whereIn('deployment_id', $ids)->whereNotNull('clock_in')
            ->get(['deployment_id', 'status', 'clock_in', 'clock_out'])->groupBy('deployment_id');
        $evaluated = Evaluation::whereIn('deployment_id', $ids)->distinct()->pluck('deployment_id')->flip();
        $narrative = NarrativeProgressService::forDeployments($school, $deployments);
        $today = Carbon::today();

        return $deployments->map(function (InternshipDeployment $d) use ($attendance, $evaluated, $narrative, $profiles, $today) {
            $rows = $attendance->get($d->id, collect());
            $hours = $rows->where('status', 'approved')->filter(fn ($a) => $a->clock_out)
                ->sum(fn ($a) => max(0, $a->clock_in->diffInMinutes($a->clock_out)) / 60);
            $required = (int) $d->required_hours;
            $hoursPct = $required > 0 ? (int) min(100, round($hours / $required * 100)) : 0;
            $last = $rows->max('clock_in');
            $lastClockIn = $last ? Carbon::parse($last) : null;

            $elapsed = null;
            if ($d->start_date && $d->end_date && $d->end_date->gt($d->start_date)) {
                $elapsed = (int) max(0, min(100, round($d->start_date->diffInDays($today, false) / $d->start_date->diffInDays($d->end_date) * 100)));
            }
            $isActive = $d->status === 'active';
            $started = $d->start_date && $d->start_date->lte($today);

            $flags = [];
            if ($isActive && $started) {
                $ref = $lastClockIn?->copy()->startOfDay() ?? $d->start_date->copy()->subDay();
                $missed = self::workingDaysBetween($ref, $today);
                if ($missed >= self::NO_CLOCK_IN_WORKING_DAYS) {
                    $flags[] = ['key' => 'no_clock_in', 'level' => 'red', 'label' => $lastClockIn ? "No clock-in for {$missed} working days" : "Has not clocked in yet ({$missed} working days)"];
                }
            }
            if ($isActive && $elapsed !== null && $elapsed >= self::BEHIND_MIN_ELAPSED && $hoursPct < $elapsed - self::BEHIND_POINTS) {
                $flags[] = ['key' => 'behind_hours', 'level' => 'amber', 'label' => "Behind on hours ({$hoursPct}% done, {$elapsed}% of time passed)"];
            }
            $prog = $narrative[$d->id] ?? ['done' => 0, 'total' => 0, 'missing_documents' => 0];
            if ($prog['missing_documents'] > 0 && $d->status !== 'inactive' && ($d->status === 'completed' || ($elapsed !== null && $elapsed >= 50))) {
                $flags[] = ['key' => 'missing_documents', 'level' => 'amber', 'label' => "{$prog['missing_documents']} required " . self::plural($prog['missing_documents'], 'document', 'documents') . ' missing'];
            }
            $hasEval = isset($evaluated[$d->id]);
            $evalDue = $isActive && !$hasEval && $d->end_date && $d->end_date->lte($today->copy()->addDays(self::EVALUATION_WINDOW_DAYS));
            if ($evalDue) {
                $ended = $d->end_date->lt($today);
                $flags[] = ['key' => 'evaluation_due', 'level' => $ended ? 'red' : 'amber', 'label' => $ended ? 'Deployment ended, no evaluation yet' : 'No evaluation yet, deployment ends soon'];
            }

            $profile = $profiles->get($d->intern_id);

            return [
                'deployment_id' => $d->id,
                'intern_id' => $d->intern_id,
                'intern_name' => $this->nameOf($d->intern),
                'intern_email' => $d->intern?->email,
                'student_number' => $profile?->student_number,
                'course' => $profile?->course,
                'year_level' => $profile?->year_level,
                'company_id' => $d->company_id,
                'company_name' => $d->company?->company_name,
                'supervisor_name' => $this->nameOf($d->supervisor),
                'status' => $d->status,
                'account_status' => SchoolStaff::accountState($d->intern),
                'start_date' => $d->start_date?->toDateString(),
                'end_date' => $d->end_date?->toDateString(),
                'required_hours' => $required,
                'hours_completed' => round($hours, 1),
                'hours_progress_pct' => $hoursPct,
                'elapsed_pct' => $elapsed,
                'narrative_done' => $prog['done'],
                'narrative_total' => $prog['total'],
                'has_evaluation' => $hasEval,
                'last_clock_in_at' => $lastClockIn?->toIso8601String(),
                'flags' => $flags,
                'needs_attention' => count($flags) > 0,
                '_eval_due' => $evalDue,
                '_ended_days' => ($isActive && $d->end_date && $d->end_date->lt($today)) ? (int) $d->end_date->diffInDays($today) : null,
                '_created_at' => $d->created_at,
            ];
        })->values();
    }

    private static function publicRow(array $row): array
    {
        return array_filter($row, fn ($k) => !str_starts_with($k, '_'), ARRAY_FILTER_USE_KEY);
    }

    // ---------------------------------------------------------------
    // What the coordinator still has to do (oldest first)
    // ---------------------------------------------------------------

    /** @return array<int, array> */
    private function pendingItems(School $school, Collection $internRows): array
    {
        $items = [];
        $now = now();
        $ageDays = fn ($t) => (int) Carbon::parse($t)->diffInDays($now);
        $deploymentIds = $internRows->pluck('deployment_id')->all();

        Document::with('deployment.intern')->whereIn('deployment_id', $deploymentIds)->where('status', 'pending')
            ->orderBy('created_at')->limit(100)->get()
            ->each(function (Document $doc) use (&$items, $ageDays) {
                $age = $ageDays($doc->created_at);
                $items[] = [
                    'type' => 'document_review',
                    'title' => "Review {$doc->document_type} from {$this->nameOf($doc->deployment?->intern)}",
                    'detail' => $age === 0 ? 'Uploaded today' : 'Waiting ' . self::daysText($age),
                    'since' => $doc->created_at->toIso8601String(),
                    'age_days' => $age,
                    'link' => "/dean/interns/{$doc->deployment_id}?tab=documents",
                ];
            });

        $internRole = SchoolStaff::roleId('intern');
        $supervisorRole = SchoolStaff::roleId('supervisor');
        User::where('school_id', $school->id)->whereIn('role_id', array_filter([$internRole, $supervisorRole]))
            ->where('status', 'pending_activation')->orderBy('updated_at')->limit(100)->get()
            ->each(function (User $u) use (&$items, $ageDays, $supervisorRole) {
                $age = $ageDays($u->updated_at);
                $role = (int) $u->role_id === (int) $supervisorRole ? 'supervisor' : 'intern';
                $expired = $u->invitation_expires_at && Carbon::parse($u->invitation_expires_at)->isPast();
                $items[] = [
                    'type' => 'invitation',
                    'title' => "{$this->nameOf($u)} hasn't accepted the {$role} invitation",
                    'detail' => ($age === 0 ? 'Sent today' : 'Sent ' . self::daysText($age) . ' ago') . ($expired ? ' (link expired)' : ''),
                    'since' => $u->updated_at->toIso8601String(),
                    'age_days' => $age,
                    'link' => null,
                ];
            });

        foreach ($internRows as $r) {
            if ($r['status'] === 'active' && !$r['supervisor_name']) {
                $age = $ageDays($r['_created_at']);
                $items[] = [
                    'type' => 'no_supervisor',
                    'title' => "{$r['intern_name']} has no supervisor assigned",
                    'detail' => "Deployed at {$r['company_name']} " . ($age === 0 ? 'today' : self::daysText($age) . ' ago'),
                    'since' => $r['_created_at']->toIso8601String(),
                    'age_days' => $age,
                    'link' => "/dean/interns/{$r['deployment_id']}",
                ];
            }
            if ($r['_eval_due']) {
                $over = $r['_ended_days'];
                $items[] = [
                    'type' => 'evaluation_due',
                    'title' => "{$r['intern_name']} still needs an evaluation",
                    'detail' => $over !== null ? 'Deployment ended ' . self::daysText($over) . ' ago' : 'Deployment ends on ' . Carbon::parse($r['end_date'])->format('M d, Y'),
                    'since' => Carbon::parse($r['end_date'])->toIso8601String(),
                    'age_days' => $over ?? 0,
                    'link' => "/dean/interns/{$r['deployment_id']}?tab=evaluations",
                ];
            } elseif ($r['_ended_days'] !== null) {
                $over = $r['_ended_days'];
                $items[] = [
                    'type' => 'close_deployment',
                    'title' => "{$r['intern_name']}'s deployment has ended but is still active",
                    'detail' => 'Ended ' . self::daysText($over) . ' ago',
                    'since' => Carbon::parse($r['end_date'])->toIso8601String(),
                    'age_days' => $over,
                    'link' => "/dean/interns/{$r['deployment_id']}",
                ];
            }
        }

        if (!NarrativeTemplate::where('school_id', $school->id)->exists()) {
            $items[] = [
                'type' => 'narrative_template',
                'title' => 'Narrative report letterhead and cover are not set up',
                'detail' => 'Reports use the default template until the coordinator fills these in.',
                'since' => null, 'age_days' => 0, 'link' => null,
            ];
        }

        usort($items, fn ($a, $b) => $b['age_days'] <=> $a['age_days']);

        return array_map(fn ($i) => $i + ['stale' => $i['age_days'] > self::STALE_DOCUMENT_DAYS], $items);
    }

    // ---------------------------------------------------------------
    // Overview
    // ---------------------------------------------------------------

    public function overview(Request $request): JsonResponse
    {
        $dean = $request->user();
        $school = $this->schoolOf($request);
        $rows = $this->internRows($school);
        $pending = $this->pendingItems($school, $rows);
        $coordinator = $this->currentCoordinator($school->id);
        $brief = $this->coordinatorBrief($coordinator, count($pending));
        $subscription = $school->currentSubscription();
        $today = Carbon::today();

        $alerts = [];
        $add = function (string $key, string $level, string $title, string $text, string $link) use (&$alerts) {
            $alerts[] = compact('key', 'level', 'title', 'text', 'link');
        };
        $count = fn (string $type) => collect($pending)->where('type', $type)->count();

        // Subscription
        $subStatus = $subscription?->effectiveStatus();
        if (!$subscription || $subStatus !== 'active') {
            $add('subscription_inactive', 'red', 'Your subscription is not active', 'Open Billing to finish or renew it so your school keeps full access.', '/dean/billing');
        } elseif ($subscription->end_date) {
            $days = (int) $today->diffInDays($subscription->end_date, false);
            if ($days <= self::SUBSCRIPTION_WARN_DAYS) {
                $add('subscription_ending', $days <= 3 ? 'red' : 'amber', 'Subscription ends in ' . self::daysText(max(0, $days)), 'Renew in Billing so interns and staff are not interrupted.', '/dean/billing');
            }
        }

        // Coordinator
        if (!$coordinator || $coordinator->status === 'inactive') {
            $add('no_coordinator', 'amber', 'Your school has no coordinator', 'Invite a coordinator so someone can manage interns, documents and evaluations.', '/dean/coordinator?tab=manage');
        } elseif ($coordinator->status === 'pending_activation') {
            $age = (int) $coordinator->updated_at->diffInDays(now());
            if ($age >= self::INVITE_STALE_DAYS || $brief['invitation_expired']) {
                $add('coordinator_invite', 'amber', "Coordinator hasn't accepted the invitation", 'Sent ' . self::daysText($age) . ' ago. You can resend it or correct the email.', '/dean/coordinator?tab=manage');
            }
        } else {
            $last = $brief['last_active_at'] ? Carbon::parse($brief['last_active_at']) : null;
            if ($last === null) {
                $add('coordinator_quiet', 'amber', "Coordinator hasn't been active yet", 'They have an account but have not signed in.', '/dean/coordinator');
            } elseif (($quiet = (int) $last->diffInDays(now())) >= self::COORDINATOR_QUIET_DAYS) {
                $add('coordinator_quiet', 'amber', "Coordinator hasn't been active in " . self::daysText($quiet), 'Check whether things are being looked after.', '/dean/coordinator');
            }
        }

        // Neglected documents
        $stale = collect($pending)->where('type', 'document_review')->where('age_days', '>', self::STALE_DOCUMENT_DAYS)->count();
        if ($stale > 0) {
            $add('stale_documents', 'red', "{$stale} " . self::plural($stale, 'document has', 'documents have') . ' waited more than ' . self::STALE_DOCUMENT_DAYS . " days for the coordinator's review", 'Reviewing them keeps interns moving toward their narrative report.', '/dean/coordinator?tab=pending');
        }

        // Interns
        $noClock = $rows->filter(fn ($r) => collect($r['flags'])->contains('key', 'no_clock_in'))->count();
        if ($noClock > 0) {
            $add('no_clock_in', 'red', "{$noClock} " . self::plural($noClock, "intern hasn't", "interns haven't") . ' clocked in for ' . self::NO_CLOCK_IN_WORKING_DAYS . ' working days', 'They may be absent or having trouble with attendance.', '/dean/interns?filter=attention');
        }
        $behind = $rows->filter(fn ($r) => collect($r['flags'])->contains('key', 'behind_hours'))->count();
        if ($behind > 0) {
            $add('behind_hours', 'amber', "{$behind} " . self::plural($behind, 'intern is', 'interns are') . ' behind on hours', 'Their hours are well below where they should be by now.', '/dean/interns?filter=attention');
        }
        if (($n = $count('no_supervisor')) > 0) {
            $add('no_supervisor', 'amber', "{$n} active " . self::plural($n, 'intern has', 'interns have') . ' no supervisor', 'Nobody is on site to log or review their attendance.', '/dean/coordinator?tab=pending');
        }
        if (($n = $count('evaluation_due')) > 0) {
            $add('evaluation_due', 'amber', "{$n} " . self::plural($n, 'intern needs', 'interns need') . ' an evaluation', 'Their deployment is ending or has ended without one.', '/dean/coordinator?tab=pending');
        }
        $staleInvites = collect($pending)->where('type', 'invitation')->where('age_days', '>=', 7)->count();
        if ($staleInvites > 0) {
            $add('stale_invites', 'blue', "{$staleInvites} " . self::plural($staleInvites, 'invitation is', 'invitations are') . ' still unanswered after a week', 'Interns or supervisors who have not set up their account.', '/dean/coordinator?tab=pending');
        }

        $live = $rows->where('status', '!=', 'inactive');
        $totalInterns = $live->count();

        $recent = $coordinator
            ? ActivityLog::where('user_id', $coordinator->id)->where('school_id', $school->id)->latest('id')->limit(6)->get()->map(fn (ActivityLog $a) => $this->activityPayload($a))
            : collect();

        return response()->json([
            'success' => true,
            'dean' => ['name' => $this->nameOf($dean)],
            'school' => ['name' => $school->school_name, 'is_suspended' => (bool) $school->is_suspended],
            'alerts' => $alerts,
            'progress' => [
                'interns_active' => $live->where('status', 'active')->count(),
                'interns_completed' => $live->where('status', 'completed')->count(),
                'interns_total' => $totalInterns,
                'average_hours_pct' => $totalInterns ? (int) round($live->avg('hours_progress_pct')) : 0,
                'narrative_complete' => $live->filter(fn ($r) => $r['narrative_total'] > 0 && $r['narrative_done'] >= $r['narrative_total'])->count(),
                'evaluations_done' => $live->where('has_evaluation', true)->count(),
            ],
            'coordinator' => $brief,
            'recent_activity' => $recent->values(),
            'subscription' => [
                'status' => $subStatus,
                'plan' => $subscription?->plan?->name,
                'end_date' => $subscription?->end_date?->format('F d, Y'),
            ],
        ]);
    }

    // ---------------------------------------------------------------
    // Coordinator monitoring
    // ---------------------------------------------------------------

    public function coordinatorProfile(Request $request): JsonResponse
    {
        $school = $this->schoolOf($request);
        $coordinator = $this->currentCoordinator($school->id);
        $pending = $coordinator ? count($this->pendingItems($school, $this->internRows($school))) : 0;

        return response()->json([
            'success' => true,
            'coordinator' => $this->coordinatorBrief($coordinator, $pending),
            'unseen_feedback' => $coordinator ? DeanFeedback::where('coordinator_id', $coordinator->id)->whereNull('read_at')->count() : 0,
        ]);
    }

    private function activityPayload(ActivityLog $a): array
    {
        return [
            'id' => $a->id,
            'module' => $a->module,
            'action' => $a->action,
            'description' => $a->description,
            'created_at' => $a->created_at->toIso8601String(),
        ];
    }

    public function coordinatorActivity(Request $request): JsonResponse
    {
        $school = $this->schoolOf($request);
        $coordinator = $this->currentCoordinator($school->id);
        if (!$coordinator) {
            return response()->json(['success' => true, 'items' => [], 'modules' => [], 'has_more' => false, 'total' => 0, 'page' => 1]);
        }

        $base = ActivityLog::where('user_id', $coordinator->id)->where('school_id', $school->id);
        $modules = (clone $base)->distinct()->orderBy('module')->pluck('module');
        if ($module = $request->query('module')) {
            $base->where('module', $module);
        }
        $page = $base->latest('id')->paginate(min(50, max(5, (int) $request->query('per_page', 20))));

        return response()->json([
            'success' => true,
            'items' => collect($page->items())->map(fn ($a) => $this->activityPayload($a))->values(),
            'modules' => $modules,
            'total' => $page->total(),
            'page' => $page->currentPage(),
            'has_more' => $page->hasMorePages(),
        ]);
    }

    public function coordinatorPending(Request $request): JsonResponse
    {
        $school = $this->schoolOf($request);
        $items = $this->pendingItems($school, $this->internRows($school));

        return response()->json([
            'success' => true,
            'items' => $items,
            'stale_threshold_days' => self::STALE_DOCUMENT_DAYS,
            'stale_count' => collect($items)->where('stale', true)->count(),
        ]);
    }

    private function feedbackPayload(DeanFeedback $f): array
    {
        return [
            'id' => $f->id,
            'message' => $f->message,
            'created_at' => $f->created_at->toIso8601String(),
            'read_at' => $f->read_at?->toIso8601String(),
            'seen' => $f->read_at !== null,
            'dean_name' => $this->nameOf($f->dean),
        ];
    }

    public function feedbackIndex(Request $request): JsonResponse
    {
        $items = DeanFeedback::with('dean')->where('school_id', $request->user()->school_id)->latest('id')->limit(100)->get();

        return response()->json(['success' => true, 'items' => $items->map(fn ($f) => $this->feedbackPayload($f))->values()]);
    }

    public function feedbackStore(Request $request): JsonResponse
    {
        $data = $request->validate(['message' => 'required|string|max:2000']);
        $dean = $request->user();
        $school = $this->schoolOf($request);
        $coordinator = SchoolStaff::coordinator($school->id);

        if (!$coordinator) {
            return response()->json(['success' => false, 'message' => 'Your school has no coordinator to send this to.'], 422);
        }
        if ($coordinator->status !== 'active') {
            return response()->json(['success' => false, 'message' => "Your coordinator hasn't accepted the invitation yet, so they can't read feedback."], 422);
        }

        $message = trim($data['message']);
        $feedback = DeanFeedback::create([
            'school_id' => $school->id,
            'dean_id' => $dean->id,
            'coordinator_id' => $coordinator->id,
            'message' => $message,
        ]);

        NotificationService::toUser('coordinator', $coordinator->id, $school->id, 'dean_feedback',
            'New feedback from your Dean', Str::limit($message, 120), '/coordinator/feedback');

        ActivityLogService::record(
            module: 'Coordinator',
            action: 'Sent feedback to coordinator',
            description: "{$dean->name} sent feedback to {$coordinator->name}.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Feedback sent.', 'feedback' => $this->feedbackPayload($feedback->load('dean'))], 201);
    }

    // ---------------------------------------------------------------
    // Interns (read-only)
    // ---------------------------------------------------------------

    public function interns(Request $request): JsonResponse
    {
        $school = $this->schoolOf($request);
        $rows = $this->internRows($school);

        $companies = $rows->filter(fn ($r) => $r['company_id'])->unique('company_id')
            ->map(fn ($r) => ['id' => $r['company_id'], 'name' => $r['company_name']])->sortBy('name')->values();

        if ($search = trim((string) $request->query('search'))) {
            $rows = $rows->filter(fn ($r) => stripos((string) $r['intern_name'], $search) !== false || stripos((string) $r['student_number'], $search) !== false);
        }
        if ($status = $request->query('status')) {
            $rows = $rows->where('status', $status);
        }
        if ($company = $request->query('company_id')) {
            $rows = $rows->where('company_id', (int) $company);
        }
        if ($request->boolean('attention')) {
            $rows = $rows->where('needs_attention', true);
        }

        return response()->json([
            'success' => true,
            'interns' => $rows->map(fn ($r) => self::publicRow($r))->values(),
            'companies' => $companies,
        ]);
    }

    public function internDetail(Request $request, int $deploymentId): JsonResponse
    {
        $d = $this->deployment($request, $deploymentId);
        if (!$d) {
            return self::notFound();
        }
        $school = $this->schoolOf($request);
        $row = $this->internRows($school)->firstWhere('deployment_id', $d->id);
        $profile = InternProfile::where('user_id', $d->intern_id)->where('school_id', $school->id)->first();
        $summary = DeploymentSummaryService::summarize($d, $profile);
        $disk = Storage::disk('public');

        $attendance = Attendance::where('deployment_id', $d->id)->orderByDesc('attendance_date')->orderByDesc('id')->limit(31)->get()
            ->map(fn (Attendance $a) => [
                'id' => $a->id,
                'date' => $a->attendance_date?->toDateString(),
                'clock_in' => $a->clock_in?->format('h:i A'),
                'clock_out' => $a->clock_out?->format('h:i A'),
                'hours' => ($a->clock_in && $a->clock_out) ? round(max(0, $a->clock_in->diffInMinutes($a->clock_out)) / 60, 1) : null,
                'status' => $a->status,
                'auto_clocked_out' => (bool) $a->auto_clocked_out,
                'clock_in_selfie_url' => $a->clock_in_selfie_path ? $disk->url($a->clock_in_selfie_path) : null,
            ]);

        $activities = DailyActivity::where('deployment_id', $d->id)->orderByDesc('activity_date')->orderByDesc('id')->limit(40)->get()
            ->map(fn (DailyActivity $a) => [
                'id' => $a->id,
                'date' => $a->activity_date?->toDateString(),
                'title' => $a->title,
                'description' => $a->description,
                'status' => $a->status,
            ]);

        $tasks = Task::with(['subtasks', 'evaluation'])->whereHas('assignees', fn ($q) => $q->where('deployment_id', $d->id))
            ->orderByDesc('id')->limit(60)->get()
            ->map(fn (Task $t) => [
                'id' => $t->id,
                'title' => $t->title,
                'description' => $t->description,
                'priority' => $t->priority,
                'status' => $t->status,
                'due_date' => $t->due_date?->toDateString(),
                'rating' => $t->evaluation ? (float) $t->evaluation->rating : null,
                'subtask_total' => $t->subtasks->count(),
                'subtask_done' => $t->subtasks->where('status', 'completed')->count(),
            ]);

        $evaluations = Evaluation::with(['evaluator', 'scores.criterion'])->where('deployment_id', $d->id)->orderByDesc('evaluation_date')->get()
            ->map(fn (Evaluation $e) => [
                'id' => $e->id,
                'evaluator_name' => $e->evaluator?->name,
                'evaluation_type' => $e->evaluation_type,
                'evaluation_date' => $e->evaluation_date?->toDateString(),
                'overall_score' => $e->overall_score,
                'remarks' => $e->remarks,
                'scores' => $e->scores->map(fn ($s) => [
                    'category' => $s->criterion?->category,
                    'criterion_name' => $s->criterion?->name,
                    'score' => $s->score,
                    'max_score' => $s->criterion?->max_score,
                ])->values(),
            ]);

        $documents = Document::where('deployment_id', $d->id)->orderByDesc('id')->get()
            ->map(fn (Document $x) => [
                'id' => $x->id,
                'document_type' => $x->document_type,
                'file_name' => $x->file_name,
                'file_url' => $disk->url($x->file_path),
                'status' => $x->status,
                'remarks' => $x->remarks,
                'uploaded_at' => $x->created_at->toIso8601String(),
            ]);

        return response()->json([
            'success' => true,
            'intern' => self::publicRow($row),
            'summary' => [
                'tasks_total' => $summary['tasks_total'],
                'tasks_completed' => $summary['tasks_completed'],
                'pending_attendance' => $summary['pending_attendance'],
                'latest_evaluation_score' => $summary['latest_evaluation_score'],
            ],
            'attendance' => $attendance->values(),
            'activities' => $activities->values(),
            'tasks' => $tasks->values(),
            'evaluations' => $evaluations->values(),
            'documents' => $documents->values(),
        ]);
    }

    public function narrativeReport(Request $request, int $deploymentId): JsonResponse
    {
        $d = $this->deployment($request, $deploymentId);

        return $d ? response()->json(NarrativeReportService::build($d)) : self::notFound();
    }

    public function narrativeDocx(Request $request, int $deploymentId): JsonResponse|BinaryFileResponse
    {
        $d = $this->deployment($request, $deploymentId);

        return $d ? app(NarrativeReportController::class)->docxResponse($d) : self::notFound();
    }
}
