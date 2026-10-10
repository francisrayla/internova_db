<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\Company;
use App\Models\DailyActivity;
use App\Models\Document;
use App\Models\Evaluation;
use App\Models\InternshipDeployment;
use App\Models\PlanChangeRequest;
use App\Models\PlanInquiry;
use App\Models\School;
use App\Models\SupervisorProfile;
use App\Models\SupportTicket;
use App\Models\Task;
use App\Models\User;
use App\Support\LocalTime;
use Illuminate\Support\Collection;

/**
 * The "needs attention" queue every dashboard shows (frontend: components/AttentionQueue.jsx).
 *
 * Each queue is a plain list of items, computed server-side from the same definitions as the tiles and lists:
 *   [ key, tone red|amber|blue|green, count, title, detail, href ]
 * An item whose count is zero is never created, so an empty array means "nothing needs you right now".
 * Rows passed in come from DeploymentSummaryService::summarize (display_status / is_finished), so "finished"
 * means the same here as everywhere else.
 */
class DashboardQueueService
{
    private static function plural(int $n, string $one, string $many): string
    {
        return $n === 1 ? $one : $many;
    }

    /**
     * One queue item, or null when there is nothing to show. `info` marks news that needs no action from the
     * person (e.g. "you finished your hours"): it is listed in the bell but does not count toward the bell badge.
     */
    private static function item(string $key, string $tone, int $count, string $title, string $detail, string $href, bool $info = false): ?array
    {
        if ($count <= 0) {
            return null;
        }

        return compact('key', 'tone', 'count', 'title', 'detail', 'href', 'info');
    }

    /** @param  array<int, array|null>  $items */
    private static function clean(array $items): array
    {
        return array_values(array_filter($items));
    }

    /** "Ana, Ben and 2 more" for a short detail line. */
    private static function names(Collection $names, int $max = 3): string
    {
        $names = $names->filter()->values();
        $shown = $names->take($max);
        $rest = $names->count() - $shown->count();

        return $shown->implode(', ') . ($rest > 0 ? " and {$rest} more" : '');
    }

    // ---------------------------------------------------------------
    // Supervisor
    // ---------------------------------------------------------------

    /**
     * @param  Collection<int, InternshipDeployment>  $deployments  every deployment at the supervisor's company
     * @param  Collection<int, array>  $rows  summarize() rows of those deployments
     */
    public static function supervisor(User $user, Collection $deployments, Collection $rows): array
    {
        $ids = $deployments->pluck('id')->all();
        $unchecked = Attendance::whereIn('deployment_id', $ids)->flagged('unchecked')->count();
        $autoClosed = Attendance::whereIn('deployment_id', $ids)->where('auto_clocked_out', true)->count();

        $toRate = 0;
        if (PlanFeatures::has($user->school, PlanFeatures::TASK_RATINGS)) {
            $toRate = Task::visibleToSupervisor($user)->where('status', 'completed')->whereDoesntHave('evaluation')->count();
        }

        $evaluated = Evaluation::whereIn('deployment_id', $ids)->distinct()->pluck('deployment_id')->flip();
        $ready = $rows->filter(fn ($r) => $r['is_finished'] && $r['display_status'] === 'completed'
            && $r['account_status'] !== 'pending_activation' && !isset($evaluated[$r['deployment_id']]))->values();

        $activities = DailyActivity::whereIn('deployment_id', $ids)->where('status', DailyActivity::PENDING)->count();

        return self::clean([
            self::item('red_flags', 'red', $unchecked,
                $unchecked . ' red ' . self::plural($unchecked, 'flag', 'flags') . ' still unchecked',
                'The backlog of odd-hours or suspicious clock-ins you have not marked as checked yet (the alerts below are the individual events).',
                '/supervisor/attendance?flag=unchecked'),
            self::item('auto_closed', 'amber', $autoClosed,
                $autoClosed . ' ' . self::plural($autoClosed, 'shift was', 'shifts were') . ' closed by the system',
                'The intern forgot to time out. Correct the time if they left earlier.',
                '/supervisor/attendance'),
            self::item('tasks_to_rate', 'amber', $toRate,
                $toRate . ' finished ' . self::plural($toRate, 'task needs', 'tasks need') . ' your rating',
                'Rate them so they close out and count toward the evaluation.',
                '/supervisor/tasks'),
            self::item('ready_to_evaluate', 'green', $ready->count(),
                $ready->count() . ' ' . self::plural($ready->count(), 'intern is', 'interns are') . ' ready to evaluate',
                self::names($ready->pluck('intern_name')) . ' finished the required hours and have no evaluation yet.',
                $ready->count() === 1 ? '/supervisor/evaluations/new?intern=' . $ready->first()['deployment_id'] : '/supervisor/evaluations/new'),
            self::item('activities', 'blue', $activities,
                $activities . ' daily ' . self::plural($activities, 'activity', 'activities') . ' waiting for approval',
                'Narrative entries the interns wrote.',
                '/supervisor/activities?status=pending'),
        ]);
    }

    // ---------------------------------------------------------------
    // Coordinator
    // ---------------------------------------------------------------

    /** @param  Collection<int, array>  $rows  the coordinator's internRows (display_status, attention) */
    public static function coordinator(User $user, Collection $rows): array
    {
        $schoolId = $user->school_id;
        $pending = $rows->where('display_status', 'invitation_pending')->count();

        $noSupervisor = Company::with('activeSupervisorProfiles')->where('school_id', $schoolId)->where('status', 'active')->get()
            ->filter(fn (Company $c) => $c->activeSupervisorProfiles->isEmpty());

        $supervisorInvites = SupervisorProfile::where('school_id', $schoolId)
            ->whereHas('user', fn ($q) => $q->where('status', 'pending_activation'))->count();

        $docs = Document::whereIn('deployment_id', $rows->pluck('deployment_id'))->where('status', 'pending')->count();

        $attention = $rows->filter(fn ($r) => count($r['attention'] ?? []) > 0)->values();
        $kinds = collect($attention)->flatMap(fn ($r) => collect($r['attention'])->pluck('key'))->countBy();
        $parts = [];
        foreach (['no_clock_in' => "haven't clocked in", 'behind_hours' => 'behind on hours', 'no_supervisor' => 'without a supervisor'] as $key => $text) {
            if (($kinds[$key] ?? 0) > 0) {
                $parts[] = "{$kinds[$key]} {$text}";
            }
        }

        $finished = $rows->where('display_status', 'completed')->values();
        $evaluated = Evaluation::whereIn('deployment_id', $finished->pluck('deployment_id'))->distinct()->pluck('deployment_id')->flip();
        $unevaluated = $finished->filter(fn ($r) => !isset($evaluated[$r['deployment_id']]))->count();

        return self::clean([
            self::item('attention', 'red', $attention->count(),
                $attention->count() . ' ' . self::plural($attention->count(), 'intern needs', 'interns need') . ' attention',
                $parts ? ucfirst(implode(', ', $parts)) . '.' : 'Open the list to see why.',
                '/coordinator/interns?filter=needs_attention'),
            self::item('companies_no_supervisor', 'amber', $noSupervisor->count(),
                $noSupervisor->count() . ' ' . self::plural($noSupervisor->count(), 'company has', 'companies have') . ' no active supervisor',
                self::names($noSupervisor->pluck('company_name')) . ': nobody there can log or review attendance.',
                '/coordinator/companies'),
            self::item('pending_accounts', 'amber', $pending,
                $pending . ' ' . self::plural($pending, 'intern has', 'interns have') . ' not set up an account',
                'They cannot get tasks until they open their invitation. Fix a wrong email or resend it.',
                '/coordinator/interns/pending'),
            self::item('supervisor_invites', 'amber', $supervisorInvites,
                $supervisorInvites . ' ' . self::plural($supervisorInvites, 'supervisor has', 'supervisors have') . ' not accepted the invitation',
                'Their company has nobody to review attendance until they do.',
                '/coordinator/supervisors'),
            self::item('documents', 'blue', $docs,
                $docs . ' ' . self::plural($docs, 'document', 'documents') . ' to review',
                'Uploaded by interns and waiting for your review.',
                '/coordinator/documents'),
            self::item('finished', 'green', $finished->count(),
                $finished->count() . ' ' . self::plural($finished->count(), 'intern', 'interns') . ' finished the required hours',
                $unevaluated > 0 ? "{$unevaluated} still " . self::plural($unevaluated, 'has', 'have') . ' no evaluation.' : 'All of them have an evaluation.',
                '/coordinator/interns?filter=completed', true),
        ]);
    }

    // ---------------------------------------------------------------
    // Intern
    // ---------------------------------------------------------------

    /**
     * "Your next step" for one intern, in priority order. $summary is the intern's DeploymentSummaryService row.
     */
    public static function intern(User $user, InternshipDeployment $d, array $summary): array
    {
        $required = (int) $d->required_hours;
        $hours = (float) $summary['hours_completed'];
        $left = max(0, round($required - $hours, 1));
        $finished = (bool) $summary['is_finished'];
        $today = LocalTime::today();
        $items = [];

        // 1. The attendance step, or the "you are done" step.
        if ($d->status === 'inactive') {
            $items[] = self::item('inactive', 'amber', 1, 'Your internship is marked inactive', 'Attendance is closed. Please contact your coordinator.', '/intern/profile');
        } elseif ($finished) {
            $items[] = self::item('finished', 'green', 1, 'You finished your required hours',
                "{$summary['hours_completed']} of {$required} hours rendered. Attendance is closed. These are the steps that are left.", '/intern/portfolio', true);
        } elseif (!$d->hasStartedOn($today)) {
            $items[] = self::item('not_started', 'blue', 1, 'Your internship starts on ' . $d->start_date->format('F j, Y'), 'You can clock in from that day.', '/intern/attendance', true);
        } else {
            $rows = Attendance::where('deployment_id', $d->id)->whereDate('attendance_date', $today)->orderBy('id')->get();
            $next = AttendanceSessions::next(AttendanceSessions::modeFor($d->company), $rows);
            $leftText = $required > 0 ? "{$left} of {$required} hours left." : '';
            if ($next && $next['action'] === 'clock_out') {
                $since = $rows->firstWhere(fn (Attendance $a) => $a->clock_in && !$a->clock_out)?->clock_in?->local()?->format('h:i A');
                $items[] = self::item('clock_out', 'green', 1, $since ? "You clocked in at {$since}" : 'You are clocked in',
                    trim("Remember to time out when you leave. {$leftText}"), '/intern/attendance', true);
            } elseif ($next) {
                $items[] = self::item('clock_in', 'blue', 1, $next['label'] === 'Time in' ? 'Clock in for today' : $next['label'],
                    $leftText ?: 'Start your day from the Attendance page.', '/intern/attendance');
            } else {
                $items[] = self::item('day_done', 'green', 1, "Today's attendance is complete", $leftText ?: 'See you on your next work day.', '/intern/attendance', true);
            }
        }

        // 2. What is left once the hours are done: report requirements and the evaluation.
        if ($finished && $d->status !== 'inactive') {
            $school = School::find($d->school_id);
            $prog = $school ? (NarrativeProgressService::forDeployments($school, collect([$d]))[$d->id] ?? null) : null;
            $evaluation = Evaluation::where('deployment_id', $d->id)->orderByDesc('evaluation_date')->orderByDesc('id')->first(['id', 'overall_score']);

            if ($prog && $prog['missing_documents'] > 0) {
                $n = $prog['missing_documents'];
                $items[] = self::item('missing_documents', 'amber', $n, "{$n} required " . self::plural($n, 'document is', 'documents are') . ' missing',
                    'Upload them so your narrative report can be completed.', '/intern/documents');
            }
            if ($prog && $prog['total'] > 0) {
                $other = $prog['total'] - $prog['done'] - $prog['missing_documents'];
                $items[] = self::item('report_items', 'amber', $other, "{$other} more narrative report " . self::plural($other, 'item', 'items') . ' to complete',
                    "{$prog['done']} of {$prog['total']} requirements are done. The checklist is in your Portfolio.", '/intern/portfolio');
                if ($prog['done'] >= $prog['total']) {
                    $items[] = self::item('report_ready', 'green', 1, 'Your narrative report is ready', 'Every requirement is complete. Open it to print or download.', '/intern/portfolio/report', true);
                }
            }
            if ($evaluation) {
                $score = $evaluation->overall_score !== null ? ' Score: ' . (float) $evaluation->overall_score . '%.' : '';
                $items[] = self::item('evaluation', 'green', 1, 'You received your evaluation', trim("Read your supervisor's feedback.{$score}"), '/intern/evaluations', true);
            } else {
                $items[] = self::item('evaluation', 'blue', 1, "Waiting for your supervisor's evaluation", 'Your supervisor can evaluate you now that the hours are done.', '/intern/evaluations', true);
            }
        }

        // 3. Tasks that are late or due within two days.
        if ($d->status !== 'inactive') {
            $open = Task::whereHas('assignees', fn ($q) => $q->where('user_id', $user->id))->where('status', '!=', 'completed')
                ->whereNotNull('due_date')->get(['id', 'due_date']);
            $overdue = $open->filter(fn (Task $t) => $t->due_date->format('Y-m-d') < $today)->count();
            $soon = $open->filter(fn (Task $t) => $t->due_date->format('Y-m-d') >= $today
                && $t->due_date->format('Y-m-d') <= \Illuminate\Support\Carbon::parse($today)->addDays(2)->toDateString())->count();
            $items[] = self::item('tasks_overdue', 'red', $overdue, $overdue . ' ' . self::plural($overdue, 'task is', 'tasks are') . ' overdue', 'Open your tasks and finish or update them.', '/intern/tasks');
            $items[] = self::item('tasks_soon', 'amber', $soon, $soon . ' ' . self::plural($soon, 'task is', 'tasks are') . ' due in the next 2 days', 'Open your tasks to see which ones.', '/intern/tasks');
        }

        // 4. Things the supervisor or coordinator sent back.
        $rejectedDocs = Document::where('deployment_id', $d->id)->where('status', 'rejected')->count();
        $items[] = self::item('rejected_documents', 'amber', $rejectedDocs, $rejectedDocs . ' ' . self::plural($rejectedDocs, 'document was', 'documents were') . ' sent back',
            'Read the remarks and upload a corrected file.', '/intern/documents');
        $rejectedActivities = DailyActivity::where('deployment_id', $d->id)->where('status', DailyActivity::REJECTED)->count();
        $items[] = self::item('rejected_activities', 'amber', $rejectedActivities, $rejectedActivities . ' narrative ' . self::plural($rejectedActivities, 'entry was', 'entries were') . ' sent back',
            'Edit them and send them again.', '/intern/activities');

        return self::clean($items);
    }

    // ---------------------------------------------------------------
    // Super Admin
    // ---------------------------------------------------------------

    public static function superAdmin(): array
    {
        $schools = School::with('subscriptions')->get();
        $verify = collect();
        $expiring = collect();
        $expired = collect();
        foreach ($schools as $school) {
            $latest = $school->subscriptions->where('status', '!=', 'scheduled')->sortByDesc('id')->first();
            if ($latest && $latest->payment_status === 'pending_verification') {
                $verify->push($school);
            }
            if ($school->is_suspended) {
                continue;
            }
            // Same pick as the Schools list: prefer the active subscription over a newer pending offer.
            $sorted = $school->subscriptions->where('status', '!=', 'scheduled')->sortByDesc('id');
            $sub = $sorted->firstWhere('status', 'active') ?? $sorted->first();
            if (!$sub) {
                continue;
            }
            if ($sub->effectiveStatus() === 'expired') {
                $expired->push($school);
            } elseif ($sub->status === 'active' && $sub->end_date) {
                $days = (int) now()->startOfDay()->diffInDays($sub->end_date->copy()->startOfDay(), false);
                if ($days >= 0 && $days <= 14) {
                    $expiring->push($school);
                }
            }
        }

        $changes = PlanChangeRequest::where('status', 'pending')->count();
        $newInquiries = PlanInquiry::where('status', 'new')->count();
        $inProgress = PlanInquiry::whereIn('status', ['contacted', 'under_discussion', 'approved'])->count();
        $tickets = SupportTicket::where('status', 'Open')->count();
        $schoolNames = fn (Collection $c) => self::names($c->pluck('school_name'));

        return self::clean([
            self::item('payments', 'red', $verify->count(),
                $verify->count() . ' bank ' . self::plural($verify->count(), 'transfer', 'transfers') . ' to verify',
                $schoolNames($verify) . ' uploaded a proof of payment. Check it and activate the school.',
                $verify->count() === 1 ? '/superadmin/schools?highlight=' . $verify->first()->id : '/superadmin/schools'),
            self::item('expired', 'red', $expired->count(),
                $expired->count() . ' ' . self::plural($expired->count(), 'subscription has', 'subscriptions have') . ' expired',
                $schoolNames($expired) . ' lost access until they renew.',
                '/superadmin/billing'),
            self::item('plan_changes', 'amber', $changes,
                $changes . ' plan change ' . self::plural($changes, 'request', 'requests') . ' waiting',
                'Schools asked to switch plan. Approve or reject them.',
                '/superadmin/billing'),
            self::item('expiring', 'amber', $expiring->count(),
                $expiring->count() . ' ' . self::plural($expiring->count(), 'subscription ends', 'subscriptions end') . ' within 14 days',
                $schoolNames($expiring) . '.',
                '/superadmin/billing'),
            self::item('inquiries', 'blue', $newInquiries,
                $newInquiries . ' new plan ' . self::plural($newInquiries, 'inquiry', 'inquiries'),
                $inProgress > 0 ? "{$inProgress} more " . self::plural($inProgress, 'is', 'are') . ' still in progress.' : 'Nobody has replied to them yet.',
                '/superadmin/inquiries'),
            self::item('tickets', 'amber', $tickets,
                $tickets . ' open support ' . self::plural($tickets, 'ticket', 'tickets'),
                'Coordinators or Deans are waiting for an answer.',
                '/superadmin/support'),
        ]);
    }
}
