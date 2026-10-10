<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\Evaluation;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Task;
use Illuminate\Support\Carbon;

/**
 * Shared shape for "an intern's current standing" on one deployment — hours,
 * tasks, evaluation — used by both the Coordinator and Supervisor monitoring
 * controllers so progress numbers never drift between what a coordinator and
 * a supervisor see for the same intern.
 */
class DeploymentSummaryService
{
    public static function summarize(InternshipDeployment $d, ?InternProfile $profile): array
    {
        $hoursCompleted = Attendance::where('deployment_id', $d->id)
            ->where('status', 'approved')
            ->whereNotNull('clock_in')
            ->whereNotNull('clock_out')
            ->get()
            ->sum(fn ($a) => max(0, Carbon::parse($a->clock_in)->diffInMinutes(Carbon::parse($a->clock_out))) / 60);

        $tasksTotal = Task::whereHas('assignees', fn ($q) => $q->where('deployment_id', $d->id))->count();
        $tasksDone = Task::whereHas('assignees', fn ($q) => $q->where('deployment_id', $d->id))->where('status', 'completed')->count();
        $pendingAttendance = Attendance::where('deployment_id', $d->id)->where('status', 'pending')->count();
        $latestEval = Evaluation::officialFor($d->id);

        // ONE definition of "finished" for every screen: marked completed, or the required hours are rendered.
        $required = (int) $d->required_hours;
        $isFinished = $d->status === 'completed' || ($required > 0 && $hoursCompleted >= $required);
        $displayStatus = match (true) {
            $d->status === 'inactive' => 'inactive',
            $isFinished => 'completed',
            $d->intern?->status === 'pending_activation' => 'invitation_pending',
            default => $d->status,
        };

        return [
            'deployment_id' => $d->id,
            'intern_id' => $d->intern_id,
            'intern_name' => trim("{$d->intern?->first_name} {$d->intern?->last_name}") ?: $d->intern?->name,
            'intern_email' => $d->intern?->email,
            'account_status' => $d->intern?->status,
            'intern_email' => $d->intern?->email,
            'email_bounced' => (bool) $d->intern?->email_bounced_at,
            'student_number' => $profile?->student_number,
            'course' => $profile?->course,
            'year_level' => $profile?->year_level,
            'company_name' => $d->company?->company_name,
            'supervisor_name' => $d->supervisorNames(),
            'status' => $d->status,
            // What the intern really is right now: inactive | completed (finished) | invitation_pending | active.
            'display_status' => $displayStatus,
            'is_finished' => $isFinished,
            'company_id' => $d->company_id,
            'start_date' => $d->start_date?->format('M d, Y'),
            'start_date_raw' => $d->start_date?->format('Y-m-d'),
            'end_date' => $d->end_date?->format('M d, Y'),
            'required_hours' => $d->required_hours,
            'hours_completed' => round($hoursCompleted, 1),
            'hours_progress_pct' => $d->required_hours > 0 ? min(100, round($hoursCompleted / $d->required_hours * 100)) : 0,
            'tasks_total' => $tasksTotal,
            'tasks_completed' => $tasksDone,
            'task_progress_pct' => $tasksTotal > 0 ? round($tasksDone / $tasksTotal * 100) : 0,
            'pending_attendance' => $pendingAttendance,
            'latest_evaluation_score' => $latestEval?->overall_score,
        ];
    }

    /**
     * The numbers every dashboard tile shows, from rows made by summarize() (the Dean's monitoring rows carry the
     * same keys), so a coordinator, a supervisor and the Dean read the same totals for the same interns.
     *  on_list  = not archived and account set up (what the Interns page lists under "All")
     *  active   = on the list and not finished;  completed = finished (hours rendered or marked completed)
     *  average  = average hours progress of every intern on the list, finished ones at their real %
     *
     * @return array{on_list:int,active:int,completed:int,pending_accounts:int,average_hours_pct:int}
     */
    public static function stats(\Illuminate\Support\Collection $rows): array
    {
        $counts = $rows->countBy('display_status');
        $onList = $rows->filter(fn ($r) => !in_array($r['display_status'], ['inactive', 'invitation_pending'], true));

        return [
            'on_list' => $onList->count(),
            'active' => (int) ($counts['active'] ?? 0),
            'completed' => (int) ($counts['completed'] ?? 0),
            'pending_accounts' => (int) ($counts['invitation_pending'] ?? 0),
            'average_hours_pct' => $onList->isEmpty() ? 0 : (int) round($onList->avg('hours_progress_pct')),
        ];
    }
}
