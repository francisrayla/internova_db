<?php

namespace App\Jobs;

use App\Models\Attendance;
use App\Models\DailyActivity;
use App\Models\Subtask;
use App\Models\Task;
use App\Services\NarrativeAiService;
use App\Services\PlanFeatures;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Backfills a narrative for a day the intern attended but never logged
 * themselves — queued (not run inline on clock-out or on the Activities
 * page load) because it may call the Gemini API, which is too slow to sit
 * inside a request/response cycle. Runs the exact same "does an entry
 * already exist" check the caller already made, since a day can be queued
 * for backfill more than once before the first run finishes.
 */
class GenerateNarrativeForAttendance implements ShouldQueue
{
    use Queueable;

    public function __construct(private readonly int $attendanceId)
    {
    }

    public function handle(): void
    {
        $attendance = Attendance::with('deployment')->find($this->attendanceId);
        if (!$attendance || !$attendance->clock_out || !$attendance->deployment) {
            return;
        }

        $deployment = $attendance->deployment;
        $date = $attendance->attendance_date->toDateString();

        $alreadyLogged = DailyActivity::where('deployment_id', $deployment->id)
            ->whereDate('activity_date', $date)
            ->exists();
        if ($alreadyLogged) {
            return;
        }

        $internId = $deployment->intern_id;

        $taskTitles = Task::whereHas('assignees', fn ($q) => $q->where('user_id', $internId))
            ->where('status', 'completed')
            ->whereDate('completed_at', $date)
            ->pluck('title');

        $subtaskTitles = Subtask::whereHas('task.assignees', fn ($q) => $q->where('user_id', $internId))
            ->where('status', 'completed')
            ->whereDate('completed_at', $date)
            ->pluck('title');

        $items = $taskTitles->merge($subtaskTitles)->values()->all();

        $clockIn = $attendance->clock_in?->format('h:i A');
        $clockOut = $attendance->clock_out?->format('h:i A');

        // AI Portfolio/Reports is a Premium feature — a Basic-plan school
        // still gets the backfilled narrative, just built from the plain
        // template below rather than phrased by Gemini.
        $narrative = PlanFeatures::has($deployment->school, PlanFeatures::AI_FEATURES)
            ? NarrativeAiService::generateFromTasking($items, $clockIn, $clockOut, $deployment->school_id, $internId)
            : null;

        if (!$narrative) {
            $narrative = $items === []
                ? "Reported for on-the-job training" . ($clockIn && $clockOut ? " from {$clockIn} to {$clockOut}." : '.') . ' No specific tasks were marked completed on this date.'
                : "Reported for on-the-job training" . ($clockIn && $clockOut ? " from {$clockIn} to {$clockOut}." : '.') . ' Completed: ' . implode(', ', $items) . '.';
        }

        // Re-check right before writing — the narrow window while the AI
        // call was in flight is the one place a race with a manually logged
        // entry could still slip through.
        $alreadyLogged = DailyActivity::where('deployment_id', $deployment->id)
            ->whereDate('activity_date', $date)
            ->exists();
        if ($alreadyLogged) {
            return;
        }

        DailyActivity::create([
            'deployment_id' => $deployment->id,
            'activity_date' => $date,
            'title' => 'Daily Activity Summary',
            'description' => $narrative,
            'status' => 'pending',
            'is_auto_generated' => true,
        ]);
    }
}
