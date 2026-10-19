<?php

namespace App\Jobs;

use App\Models\Attendance;
use App\Models\DailyActivity;
use App\Models\InternshipDeployment;
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

        // A split day is written once, from its first time in to its last time out.
        $dayRows = Attendance::where('deployment_id', $deployment->id)->whereDate('attendance_date', $date)->get();
        if ($dayRows->contains(fn ($r) => $r->clock_in && !$r->clock_out && $date === \App\Support\LocalTime::today())) {
            return;
        }

        $internId = $deployment->intern_id;
        ['items' => $items, 'clock_in' => $clockIn, 'clock_out' => $clockOut] = self::dayFacts($deployment, $date);

        // AI Narrative Writing is a Premium feature — a Basic-plan school
        // still gets the backfilled narrative, just built from the plain
        // template below rather than phrased by Gemini.
        $narrative = PlanFeatures::has($deployment->school, PlanFeatures::AI_FEATURES)
            ? NarrativeAiService::generateFromTasking($items, $clockIn, $clockOut, $deployment->school_id, $internId)
            : null;

        if (!$narrative) {
            $narrative = self::plainNarrative($items, $clockIn, $clockOut);
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
            'status' => DailyActivity::RECORDED,
            'is_auto_generated' => true,
        ]);
    }

    /**
     * What a day's summary is built from: the titles of the tasks/subtasks finished that Manila day, and the first
     * time in / last time out of its finished attendance ('h:i A', or null when no shift of the day is closed).
     *
     * @return array{items: array<int, string>, clock_in: ?string, clock_out: ?string}
     */
    public static function dayFacts(InternshipDeployment $deployment, string $date): array
    {
        $internId = $deployment->intern_id;
        $closed = Attendance::where('deployment_id', $deployment->id)->whereDate('attendance_date', $date)->get()
            ->filter(fn ($r) => $r->clock_in && $r->clock_out);

        $taskTitles = Task::whereHas('assignees', fn ($q) => $q->where('user_id', $internId))
            ->where('status', 'completed')
            ->where(fn ($q) => \App\Support\LocalTime::whereLocalDate($q, 'completed_at', $date))
            ->pluck('title');

        $subtaskTitles = Subtask::whereHas('task.assignees', fn ($q) => $q->where('user_id', $internId))
            ->where('status', 'completed')
            ->where(fn ($q) => \App\Support\LocalTime::whereLocalDate($q, 'completed_at', $date))
            ->pluck('title');

        return [
            'items' => $taskTitles->merge($subtaskTitles)->values()->all(),
            'clock_in' => $closed->min('clock_in')?->local()?->format('h:i A'),
            'clock_out' => $closed->max('clock_out')?->local()?->format('h:i A'),
        ];
    }

    /** The template text (no AI): used when AI is off or fails, and when a correction rewrites a draft in place. */
    public static function plainNarrative(array $items, ?string $clockIn, ?string $clockOut): string
    {
        $head = 'Reported for on-the-job training' . ($clockIn && $clockOut ? " from {$clockIn} to {$clockOut}." : '.');

        return $items === []
            ? $head . ' No specific tasks were marked completed on this date.'
            : $head . ' Completed: ' . implode(', ', $items) . '.';
    }
}
