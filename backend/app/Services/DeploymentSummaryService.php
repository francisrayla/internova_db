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
        $latestEval = Evaluation::where('deployment_id', $d->id)->latest('evaluation_date')->first();

        return [
            'deployment_id' => $d->id,
            'intern_id' => $d->intern_id,
            'intern_name' => trim("{$d->intern?->first_name} {$d->intern?->last_name}") ?: $d->intern?->name,
            'intern_email' => $d->intern?->email,
            'student_number' => $profile?->student_number,
            'course' => $profile?->course,
            'year_level' => $profile?->year_level,
            'company_name' => $d->company?->company_name,
            'supervisor_name' => $d->supervisor ? (trim("{$d->supervisor->first_name} {$d->supervisor->last_name}") ?: $d->supervisor->name) : null,
            'status' => $d->status,
            'company_id' => $d->company_id,
            'supervisor_id' => $d->supervisor_id,
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
}
