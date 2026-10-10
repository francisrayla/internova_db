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
use App\Services\CoordinatorInsightsService;
use App\Services\DeanReportDocxService;
use App\Services\DeploymentHistoryService;
use App\Services\DeploymentSummaryService;
use App\Services\FeedbackThreadService;
use App\Services\InternMonitoringService;
use App\Services\NarrativeProgressService;
use App\Services\NarrativeReportService;
use App\Services\NotificationService;
use App\Services\SchoolStaff;
use App\Support\Paging;
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
    public const NO_CLOCK_IN_WORKING_DAYS = InternMonitoringService::NO_CLOCK_IN_WORKING_DAYS;
    public const BEHIND_POINTS = InternMonitoringService::BEHIND_POINTS;
    public const BEHIND_MIN_ELAPSED = InternMonitoringService::BEHIND_MIN_ELAPSED;
    public const COORDINATOR_QUIET_DAYS = 3;
    public const INVITE_STALE_DAYS = 3;
    public const EVALUATION_WINDOW_DAYS = InternMonitoringService::EVALUATION_WINDOW_DAYS;
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
        return InternshipDeployment::with(['intern', 'company.activeSupervisorProfiles.user'])
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

    /** @return Collection<int, array> */
    private function internRows(School $school): Collection
    {
        return InternMonitoringService::rows($school);
    }

    private static function publicRow(array $row): array
    {
        return InternMonitoringService::publicRow($row);
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
            if ($r['display_status'] === 'active' && !$r['supervisor_name']) {
                $age = $ageDays($r['_created_at']);
                $items[] = [
                    'type' => 'no_supervisor',
                    'title' => "{$r['intern_name']} has no supervisor at their company",
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

    /**
     * The Dean's "needs attention" list, worked out from the school's real activity (the school comes from the
     * signed-in Dean only). Shown in the bell, not on the dashboard; same item shape as DashboardQueueService.
     */
    public function attentionQueue(User $dean): array
    {
        $school = School::findOrFail($dean->school_id);
        $rows = $this->internRows($school);
        $pending = $this->pendingItems($school, $rows);
        $coordinator = $this->currentCoordinator($school->id);
        $brief = $this->coordinatorBrief($coordinator, count($pending));

        return array_map(fn (array $a) => [
            'key' => $a['key'], 'tone' => $a['level'], 'count' => null, 'title' => $a['title'], 'detail' => $a['text'], 'href' => $a['link'], 'info' => false,
        ], $this->buildAlerts($rows, $pending, $coordinator, $brief, $school->currentSubscription()));
    }

    private function buildAlerts($rows, array $pending, ?User $coordinator, array $brief, $subscription): array
    {
        $today = \App\Support\LocalTime::todayDate();
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
            $add('no_coordinator', 'amber', 'Your school has no coordinator', 'Invite a coordinator so someone can manage interns, documents and evaluations.', '/dean/coordinator/manage');
        } elseif ($coordinator->status === 'pending_activation') {
            $age = (int) $coordinator->updated_at->diffInDays(now());
            if ($age >= self::INVITE_STALE_DAYS || $brief['invitation_expired']) {
                $add('coordinator_invite', 'amber', "Coordinator hasn't accepted the invitation", 'Sent ' . self::daysText($age) . ' ago. You can resend it or correct the email.', '/dean/coordinator/manage');
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
            $add('no_supervisor', 'amber', "{$n} active " . self::plural($n, 'intern has', 'interns have') . ' no supervisor at their company', 'Nobody is on site to log or review their attendance.', '/dean/coordinator?tab=pending');
        }
        if (($n = $count('evaluation_due')) > 0) {
            $add('evaluation_due', 'amber', "{$n} " . self::plural($n, 'intern needs', 'interns need') . ' an evaluation', 'Their deployment is ending or has ended without one.', '/dean/coordinator?tab=pending');
        }
        $staleInvites = collect($pending)->where('type', 'invitation')->where('age_days', '>=', 7)->count();
        if ($staleInvites > 0) {
            $add('stale_invites', 'blue', "{$staleInvites} " . self::plural($staleInvites, 'invitation is', 'invitations are') . ' still unanswered after a week', 'Interns or supervisors who have not set up their account.', '/dean/coordinator?tab=pending');
        }

        return $alerts;
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
        $today = \App\Support\LocalTime::todayDate();

        $subStatus = $subscription?->effectiveStatus();
        $alerts = $this->buildAlerts($rows, $pending, $coordinator, $brief, $subscription);

        $live = $rows->where('status', '!=', 'inactive');
        $totalInterns = $live->count();
        // Same definitions as the coordinator and supervisor tiles (DeploymentSummaryService::stats).
        $stats = DeploymentSummaryService::stats($rows);

        $recent = $coordinator
            ? ActivityLog::where('user_id', $coordinator->id)->where('school_id', $school->id)->latest('id')->limit(6)->get()->map(fn (ActivityLog $a) => $this->activityPayload($a))
            : collect();

        return response()->json([
            'success' => true,
            'dean' => ['name' => $this->nameOf($dean)],
            'school' => ['name' => $school->school_name, 'is_suspended' => (bool) $school->is_suspended],
            'alerts' => $alerts,
            'progress' => [
                'interns_active' => $stats['active'],
                'interns_completed' => $stats['completed'],
                'interns_pending_accounts' => $stats['pending_accounts'],
                'interns_total' => $totalInterns,
                'groups' => InternMonitoringService::groupCounts($rows),
                'average_hours_pct' => $stats['average_hours_pct'],
                'narrative_complete' => $live->filter(fn ($r) => $r['narrative_total'] > 0 && $r['narrative_done'] >= $r['narrative_total'])->count(),
                'evaluations_done' => $live->where('has_evaluation', true)->count(),
            ],
            'coordinator' => $brief,
            'setup' => collect(CoordinatorInsightsService::checklist($school, $rows))->only(['done', 'total']),
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
            'unseen_feedback' => $coordinator ? FeedbackThreadService::coordinatorUnread($coordinator) : 0,
            'unread_replies' => FeedbackThreadService::deanUnread($school->id),
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

    private function thread(Request $request, int $id): ?DeanFeedback
    {
        return DeanFeedback::with(['dean', 'coordinator', 'replies.user'])->where('school_id', $request->user()->school_id)->find($id);
    }

    public function feedbackIndex(Request $request): JsonResponse
    {
        $items = DeanFeedback::with(['dean', 'coordinator', 'replies.user'])->where('school_id', $request->user()->school_id)->latest('id')->limit(100)->get();

        return response()->json([
            'success' => true,
            'items' => $items->map(fn ($f) => FeedbackThreadService::payload($f, 'dean'))->values(),
            'unread_count' => FeedbackThreadService::deanUnread($request->user()->school_id),
        ]);
    }

    public function feedbackUnreadCount(Request $request): JsonResponse
    {
        return response()->json(['unread_count' => FeedbackThreadService::deanUnread($request->user()->school_id)]);
    }

    public function feedbackReadAll(Request $request): JsonResponse
    {
        DeanFeedback::where('school_id', $request->user()->school_id)->get()->each(fn ($f) => FeedbackThreadService::markReadFor('dean', $f));

        return response()->json(['success' => true]);
    }

    public function feedbackReply(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['message' => 'required|string|max:2000']);
        $f = $this->thread($request, $id);
        if (!$f) {
            return self::notFound('Feedback');
        }
        FeedbackThreadService::reply($f, $request->user(), 'dean', $data['message']);

        return response()->json(['success' => true, 'feedback' => FeedbackThreadService::payload($f->fresh(), 'dean')], 201);
    }

    public function feedbackResolve(Request $request, int $id): JsonResponse
    {
        $f = $this->thread($request, $id);
        if (!$f) {
            return self::notFound('Feedback');
        }
        FeedbackThreadService::resolve($f);

        return response()->json(['success' => true, 'feedback' => FeedbackThreadService::payload($f->fresh(), 'dean')]);
    }

    public function feedbackReopen(Request $request, int $id): JsonResponse
    {
        $f = $this->thread($request, $id);
        if (!$f) {
            return self::notFound('Feedback');
        }
        FeedbackThreadService::reopen($f);

        return response()->json(['success' => true, 'feedback' => FeedbackThreadService::payload($f->fresh(), 'dean')]);
    }

    public function coordinatorInsights(Request $request): JsonResponse
    {
        $school = $this->schoolOf($request);
        $rows = $this->internRows($school);

        return response()->json([
            'success' => true,
            'scorecard' => CoordinatorInsightsService::scorecard($school, $rows),
            'checklist' => CoordinatorInsightsService::checklist($school, $rows),
            'activity_chart' => CoordinatorInsightsService::activityChart($school, $this->currentCoordinator($school->id)),
        ]);
    }

    public function schoolReportDocx(Request $request): BinaryFileResponse
    {
        @set_time_limit(120);
        $school = $this->schoolOf($request);
        $rows = $this->internRows($school);
        $coordinator = $this->currentCoordinator($school->id);
        $path = DeanReportDocxService::build([
            'school' => $school,
            'generated_at' => \App\Support\LocalTime::now(),
            'rows' => $rows,
            'groups' => InternMonitoringService::groupCounts($rows),
            'scorecard' => CoordinatorInsightsService::scorecard($school, $rows),
            'checklist' => CoordinatorInsightsService::checklist($school, $rows),
            'activity' => CoordinatorInsightsService::activityChart($school, $coordinator),
            'coordinator' => $this->nameOf($coordinator),
        ]);
        $name = 'School_Monitoring_Report_' . \App\Support\LocalTime::now()->format('Y-m-d') . '.docx';

        return response()->download($path, $name, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ])->deleteFileAfterSend(true);
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
            'status' => DeanFeedback::OPEN,
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

        return response()->json(['success' => true, 'message' => 'Feedback sent.', 'feedback' => FeedbackThreadService::payload($feedback->fresh(), 'dean')], 201);
    }

    // ---------------------------------------------------------------
    // Interns (read-only)
    // ---------------------------------------------------------------

    /** Sortable columns of the interns table (same keys as frontend/src/components/dean/InternTable.jsx). */
    private const SORT_KEYS = ['name', 'group', 'company', 'hours', 'finish', 'clock', 'journal', 'tasks', 'eval', 'narrative'];

    private static function sortValue(array $r, string $key): string|int|float|null
    {
        return match ($key) {
            'name' => mb_strtolower((string) ($r['intern_name'] ?? '')),
            'group' => (($i = array_search($r['status_group'] ?? null, ['at_risk', 'needs_attention', 'on_track', 'completed'], true)) === false) ? 9 : $i,
            'company' => mb_strtolower((string) ($r['company_name'] ?? '')),
            'hours' => $r['hours_progress_pct'] ?? null,
            'finish' => $r['projection']['finish_date'] ?? null,
            'clock' => !empty($r['last_clock_in_at']) ? strtotime($r['last_clock_in_at']) : null,
            'journal' => $r['journal_entries'] ?? null,
            'tasks' => $r['tasks_done'] ?? null,
            'eval' => isset($r['latest_evaluation_score']) ? (float) $r['latest_evaluation_score'] : null,
            'narrative' => !empty($r['narrative_total']) ? $r['narrative_done'] / $r['narrative_total'] : -1,
            default => null,
        };
    }

    /** Stable sort by one column; rows without a value always come last, in either direction. */
    private static function sortRows(Collection $rows, string $key, int $dir): Collection
    {
        if (!in_array($key, self::SORT_KEYS, true)) {
            return $rows;
        }

        return $rows->values()->sort(function (array $a, array $b) use ($key, $dir) {
            $x = self::sortValue($a, $key);
            $y = self::sortValue($b, $key);
            if ($x === null || $y === null) {
                return ($x === null ? 1 : 0) - ($y === null ? 1 : 0);
            }

            return ($x <=> $y) * $dir;
        })->values();
    }

    public function interns(Request $request): JsonResponse
    {
        $school = $this->schoolOf($request);
        $rows = $this->internRows($school);
        $summary = InternMonitoringService::groupCounts($rows);

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
        if ($group = $request->query('group')) {
            $rows = $rows->where('status_group', $group);
        }
        if ($request->boolean('attention')) {
            $rows = $rows->where('needs_attention', true);
        }
        // A column the Dean sorts by orders the WHOLE filtered list (so page 2 continues page 1); without one the risk-first order stays.
        $rows = self::sortRows($rows, (string) $request->query('sort'), $request->query('dir') === 'desc' ? -1 : 1);

        // Opt-in paging (the coordinator tab reads the whole list): filters above already ran on every row.
        if (Paging::requested($request)) {
            $page = Paging::collection($rows->values(), $request, 18, 50);

            return response()->json([
                'success' => true,
                'interns' => collect($page->items())->map(fn ($r) => self::publicRow($r))->values(),
                ...Paging::meta($page),
                'summary' => $summary,
                'companies' => $companies,
            ]);
        }

        return response()->json([
            'success' => true,
            'interns' => $rows->map(fn ($r) => self::publicRow($r))->values(),
            'summary' => $summary,
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

        $attendance = Attendance::with('redFlagChecker')->where('deployment_id', $d->id)->orderByDesc('attendance_date')->orderByDesc('id')->limit(31)->get()
            ->map(fn (Attendance $a) => [
                'id' => $a->id,
                'date' => $a->attendance_date?->toDateString(),
                'session' => $a->session ?: Attendance::FULL,
                'session_label' => match ($a->session) { Attendance::AM => 'Morning', Attendance::PM => 'Afternoon', default => null },
                'clock_in' => $a->clock_in?->local()?->format('h:i A'),
                'clock_out' => $a->clock_out?->local()?->format('h:i A'),
                'hours' => ($a->clock_in && $a->clock_out) ? round(max(0, $a->clock_in->diffInMinutes($a->clock_out)) / 60, 1) : null,
                'status' => $a->status,
                'auto_clocked_out' => (bool) $a->auto_clocked_out,
                'clock_in_selfie_url' => $a->clock_in_selfie_path ? $disk->url($a->clock_in_selfie_path) : null,
                'clock_out_selfie_url' => $a->clock_out_selfie_path ? $disk->url($a->clock_out_selfie_path) : null,
                'edited' => $a->edited_at !== null,
                ...$a->redFlagPayload(),
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
            'calendar_days' => InternMonitoringService::expandCalendar($row['calendar']),
            'summary' => [
                'tasks_total' => $summary['tasks_total'],
                'tasks_completed' => $summary['tasks_completed'],
                'pending_attendance' => $summary['pending_attendance'],
                'latest_evaluation_score' => $summary['latest_evaluation_score'],
            ],
            // The lists below are capped (newest first); the totals let the screen say so instead of hiding older rows.
            'totals' => [
                'attendance' => Attendance::where('deployment_id', $d->id)->count(),
                'activities' => DailyActivity::where('deployment_id', $d->id)->count(),
                'tasks' => Task::whereHas('assignees', fn ($q) => $q->where('deployment_id', $d->id))->count(),
            ],
            'attendance' => $attendance->values(),
            'activities' => $activities->values(),
            'tasks' => $tasks->values(),
            'evaluations' => $evaluations->values(),
            'documents' => $documents->values(),
            // Placements in date order; empty when the intern was never reassigned.
            'history' => DeploymentHistoryService::segments($d),
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
