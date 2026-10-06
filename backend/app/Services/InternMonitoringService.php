<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\DailyActivity;
use App\Models\Evaluation;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\School;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Everything the Dean sees about interns, computed for the whole school with a
 * FIXED number of queries (no per-intern queries): flags, status group,
 * projected finish date and the attendance calendar.
 *
 * STATUS GROUPS (one place: classify()). Inactive (withdrawn) deployments get
 * group "inactive" and are left out of every count.
 *   completed        deployment status is completed, OR approved hours >= required hours
 *   at_risk          (still active) any of:
 *                      - projected finish date is after the deployment end date
 *                      - no clock-in for AT_RISK_NO_CLOCK_IN_WORKING_DAYS (5) working days
 *                      - 2 or more flags
 *   needs_attention  exactly 1 flag
 *   on_track         no flags
 * FLAGS: no_clock_in (3+ working days), behind_hours (hours% more than 20 points
 * under working-days-elapsed%, once 15% has passed), missing_documents,
 * evaluation_due (see rows()).
 *
 * WORKING DAYS = Monday to Friday; holidays are not excluded.
 */
class InternMonitoringService
{
    public const NO_CLOCK_IN_WORKING_DAYS = 3;          // flag
    public const AT_RISK_NO_CLOCK_IN_WORKING_DAYS = 5;  // at risk on its own
    public const AT_RISK_FLAG_COUNT = 2;
    public const BEHIND_POINTS = 20;
    public const BEHIND_MIN_ELAPSED = 15;
    public const EVALUATION_WINDOW_DAYS = 14;
    public const PACE_WINDOW_DAYS = 21;                 // "recent pace" = last 3 weeks
    public const MIN_DAYS_FOR_PROJECTION = 2;           // attendance days needed for a projection

    public const GROUPS = ['at_risk', 'needs_attention', 'on_track', 'completed'];
    public const GROUP_LABELS = [
        'at_risk' => 'At risk',
        'needs_attention' => 'Needs attention',
        'on_track' => 'On track',
        'completed' => 'Completed',
    ];

    public static function nameOf(?User $u): ?string
    {
        return $u ? (trim("{$u->first_name} {$u->last_name}") ?: $u->name) : null;
    }

    private static function plural(int $n, string $one, string $many): string
    {
        return $n === 1 ? $one : $many;
    }

    /** Mon-Fri days from $from to $to, both included. */
    public static function countWeekdays(Carbon $from, Carbon $to): int
    {
        $from = $from->copy()->startOfDay();
        $to = $to->copy()->startOfDay();
        if ($to->lt($from)) {
            return 0;
        }
        $total = (int) $from->diffInDays($to) + 1;
        $n = intdiv($total, 7) * 5;
        $d = $from->copy()->addDays(intdiv($total, 7) * 7);
        while ($d->lte($to)) {
            if ($d->isWeekday()) {
                $n++;
            }
            $d->addDay();
        }

        return $n;
    }

    /** Working days strictly after $after and strictly before $before. */
    public static function workingDaysBetween(Carbon $after, Carbon $before): int
    {
        return self::countWeekdays($after->copy()->addDay(), $before->copy()->subDay());
    }

    public static function calendarStart(?Carbon $today = null): Carbon
    {
        return ($today ?? Carbon::today())->copy()->startOfWeek(Carbon::MONDAY)->subWeeks(3)->startOfDay();
    }

    // ---------------------------------------------------------------
    // Pure rules
    // ---------------------------------------------------------------

    /**
     * @param  array<string, float>  $dayHours  'Y-m-d' => approved, completed hours that day
     */
    public static function project(string $status, ?Carbon $start, ?Carbon $end, int $required, float $hours, array $dayHours, Carbon $today): array
    {
        $none = fn (string $state, string $label, string $tone = 'slate') => [
            'state' => $state, 'label' => $label, 'note' => null, 'tone' => $tone,
            'finish_date' => null, 'days_vs_end' => null, 'late' => false, 'pace_hours_per_day' => null,
        ];

        if ($status === 'inactive') {
            return $none('inactive', 'Not active');
        }
        if ($status === 'completed') {
            return $none('completed', 'Completed', 'green');
        }
        if ($required > 0 && $hours >= $required) {
            return $none('met', 'Required hours already met', 'green');
        }
        if ($start && $start->gt($today)) {
            return $none('not_started', 'Starts ' . $start->format('M j'));
        }
        if ($required <= 0 || !$start || count($dayHours) < self::MIN_DAYS_FOR_PROJECTION) {
            return $none('no_data', 'Not enough attendance yet');
        }

        $yesterday = $today->copy()->subDay();
        $pace = function (Carbon $from) use ($start, $yesterday, $dayHours): ?array {
            $from = $from->lt($start) ? $start->copy() : $from;
            $days = self::countWeekdays($from, $yesterday);
            if ($days <= 0) {
                return null;
            }
            $f = $from->toDateString();
            $t = $yesterday->toDateString();
            $sum = 0.0;
            foreach ($dayHours as $date => $h) {
                if ($date >= $f && $date <= $t) {
                    $sum += $h;
                }
            }

            return [$sum, $days];
        };
        $p = $pace($today->copy()->subDays(self::PACE_WINDOW_DAYS));
        if (!$p || $p[0] <= 0) {
            $p = $pace($start);
        }
        if (!$p || $p[0] <= 0) {
            return $none('no_data', 'Not enough attendance yet');
        }

        $perDay = $p[0] / $p[1];
        $need = (int) min(1500, max(1, ceil(($required - $hours) / $perDay)));
        $finish = $today->copy()->startOfDay()->addWeekdays($need);

        $diff = null;
        $note = null;
        $late = false;
        if ($end) {
            $diff = (int) $end->copy()->startOfDay()->diffInDays($finish, false);
            $late = $diff > 0;
            $abs = abs($diff);
            $span = $abs >= 14 ? round($abs / 7) . ' weeks' : $abs . ' ' . self::plural($abs, 'day', 'days');
            $note = $diff === 0 ? 'Right on the end date' : $span . ($late ? ' after' : ' before') . ' the end date';
        }

        return [
            'state' => 'projected',
            'label' => 'On pace to finish ' . $finish->format('M j'),
            'note' => $note,
            'tone' => $late ? 'red' : 'green',
            'finish_date' => $finish->toDateString(),
            'days_vs_end' => $diff,
            'late' => $late,
            'pace_hours_per_day' => round($perDay, 1),
        ];
    }

    /** @return array{group:string,label:string,reasons:array<int,string>} */
    public static function classify(string $status, bool $hoursMet, array $flags, int $missedWorkingDays, array $projection): array
    {
        $result = fn (string $g, array $reasons = []) => ['group' => $g, 'label' => self::GROUP_LABELS[$g] ?? 'Not active', 'reasons' => $reasons];

        if ($status === 'inactive') {
            return $result('inactive');
        }
        if ($status === 'completed' || $hoursMet) {
            return $result('completed');
        }

        $reasons = [];
        if (($projection['late'] ?? false) === true) {
            $reasons[] = 'Projected to finish after the end date';
        }
        if ($missedWorkingDays >= self::AT_RISK_NO_CLOCK_IN_WORKING_DAYS && collect($flags)->contains('key', 'no_clock_in')) {
            $reasons[] = "No clock-in for {$missedWorkingDays} working days";
        }
        if (count($flags) >= self::AT_RISK_FLAG_COUNT) {
            $reasons[] = count($flags) . ' things need attention';
        }
        if ($reasons) {
            return $result('at_risk', $reasons);
        }
        if ($flags) {
            return $result('needs_attention', array_column($flags, 'label'));
        }

        return $result('on_track');
    }

    /**
     * 28 days (4 weeks, Monday first) of attendance state.
     * Codes: P present (approved) | M pending | X rejected | A absent | O off (weekend / outside deployment) | F not yet.
     *
     * @param  array<string, array{state:string,hours:?float}>  $byDate
     * @return array<int, array{date:string,code:string,hours:?float}>
     */
    public static function calendar(string $status, ?Carbon $start, ?Carbon $end, array $byDate, Carbon $today, ?Carbon $calStart = null): array
    {
        $calStart = $calStart ?? self::calendarStart($today);
        $lastAttended = $byDate ? max(array_keys($byDate)) : null;
        $days = [];
        for ($i = 0; $i < 28; $i++) {
            $d = $calStart->copy()->addDays($i);
            $key = $d->toDateString();
            $hit = $byDate[$key] ?? null;
            $hours = null;
            if ($hit) {
                $code = ['approved' => 'P', 'pending' => 'M', 'rejected' => 'X'][$hit['state']] ?? 'M';
                $hours = $hit['hours'];
            } elseif ($d->gte($today)) {
                $code = 'F';
            } elseif ($d->isWeekend() || !$start || $d->lt($start) || ($end && $d->gt($end)) || $status === 'inactive'
                || ($status === 'completed' && ($lastAttended === null || $key > $lastAttended))) {
                $code = 'O';
            } else {
                $code = 'A';
            }
            $days[] = ['date' => $key, 'code' => $code, 'hours' => $hours];
        }

        return $days;
    }

    // ---------------------------------------------------------------
    // The school's intern rows
    // ---------------------------------------------------------------

    /** @return Collection<int, array> rows; keys starting with "_" are internal. */
    public static function rows(School $school): Collection
    {
        $deployments = InternshipDeployment::with(['intern', 'company', 'supervisor'])
            ->where('school_id', $school->id)->orderByDesc('id')->get();
        if ($deployments->isEmpty()) {
            return collect();
        }
        $ids = $deployments->pluck('id')->all();
        $profiles = InternProfile::where('school_id', $school->id)->get()->keyBy('user_id');

        $attendance = Attendance::whereIn('deployment_id', $ids)->whereNotNull('clock_in')
            ->get(['deployment_id', 'attendance_date', 'status', 'clock_in', 'clock_out'])->groupBy('deployment_id');
        $latestEval = [];
        Evaluation::whereIn('deployment_id', $ids)->orderBy('evaluation_date')->orderBy('id')
            ->get(['id', 'deployment_id', 'evaluation_date', 'overall_score'])
            ->each(function ($e) use (&$latestEval) {
                $latestEval[$e->deployment_id] = $e;
            });
        $journal = DailyActivity::whereIn('deployment_id', $ids)->selectRaw('deployment_id, count(*) as c')
            ->groupBy('deployment_id')->pluck('c', 'deployment_id');
        $tasks = DB::table('task_assignees')->join('tasks', 'tasks.id', '=', 'task_assignees.task_id')
            ->whereIn('task_assignees.deployment_id', $ids)
            ->selectRaw("task_assignees.deployment_id as deployment_id, count(*) as total, sum(case when tasks.status = 'completed' then 1 else 0 end) as done")
            ->groupBy('task_assignees.deployment_id')->get()->keyBy('deployment_id');
        $narrative = NarrativeProgressService::forDeployments($school, $deployments);
        $today = Carbon::today();
        $calStart = self::calendarStart($today);

        $rows = $deployments->map(function (InternshipDeployment $d) use ($attendance, $latestEval, $journal, $tasks, $narrative, $profiles, $today, $calStart) {
            $att = $attendance->get($d->id, collect());
            $dayHours = [];
            $byDate = [];
            $hours = 0.0;
            $rank = ['approved' => 3, 'pending' => 2, 'rejected' => 1];
            foreach ($att as $a) {
                $key = ($a->attendance_date ?? $a->clock_in)->toDateString();
                $h = $a->clock_out ? max(0, $a->clock_in->diffInMinutes($a->clock_out)) / 60 : null;
                if ($a->status === 'approved' && $h !== null) {
                    $hours += $h;
                    $dayHours[$key] = ($dayHours[$key] ?? 0) + $h;
                }
                $cur = $byDate[$key] ?? null;
                if (!$cur || ($rank[$a->status] ?? 0) > ($rank[$cur['state']] ?? 0)) {
                    $byDate[$key] = ['state' => $a->status, 'hours' => $a->status === 'approved' ? $h : null];
                } elseif ($cur['state'] === $a->status && $a->status === 'approved' && $h !== null) {
                    $byDate[$key]['hours'] = ($cur['hours'] ?? 0) + $h;
                }
            }
            $required = (int) $d->required_hours;
            $hoursPct = $required > 0 ? (int) min(100, round($hours / $required * 100)) : 0;
            $last = $att->max('clock_in');
            $lastClockIn = $last ? Carbon::parse($last) : null;

            $elapsed = null;
            if ($d->start_date && $d->end_date && $d->end_date->gte($d->start_date)) {
                $totalWd = self::countWeekdays($d->start_date, $d->end_date);
                if ($totalWd > 0) {
                    $passed = self::countWeekdays($d->start_date, $today->copy()->subDay()->min($d->end_date));
                    $elapsed = (int) max(0, min(100, round($passed / $totalWd * 100)));
                }
            }
            $isActive = $d->status === 'active';
            $started = $d->start_date && $d->start_date->lte($today);

            $flags = [];
            $missed = 0;
            if ($isActive && $started) {
                $ref = $lastClockIn?->copy()->startOfDay() ?? $d->start_date->copy()->subDay();
                $missed = self::workingDaysBetween($ref, $today);
                if ($missed >= self::NO_CLOCK_IN_WORKING_DAYS) {
                    $flags[] = ['key' => 'no_clock_in', 'level' => 'red', 'label' => $lastClockIn ? "No clock-in for {$missed} working days" : "Has not clocked in yet ({$missed} working days)"];
                }
            }
            if ($isActive && $elapsed !== null && $elapsed >= self::BEHIND_MIN_ELAPSED && $hoursPct < $elapsed - self::BEHIND_POINTS) {
                $flags[] = ['key' => 'behind_hours', 'level' => 'amber', 'label' => "Behind on hours ({$hoursPct}% done, {$elapsed}% of working days passed)"];
            }
            $prog = $narrative[$d->id] ?? ['done' => 0, 'total' => 0, 'missing_documents' => 0];
            if ($prog['missing_documents'] > 0 && $d->status !== 'inactive' && ($d->status === 'completed' || ($elapsed !== null && $elapsed >= 50))) {
                $flags[] = ['key' => 'missing_documents', 'level' => 'amber', 'label' => "{$prog['missing_documents']} required " . self::plural($prog['missing_documents'], 'document', 'documents') . ' missing'];
            }
            $eval = $latestEval[$d->id] ?? null;
            $evalDue = $isActive && !$eval && $d->end_date && $d->end_date->lte($today->copy()->addDays(self::EVALUATION_WINDOW_DAYS));
            if ($evalDue) {
                $ended = $d->end_date->lt($today);
                $flags[] = ['key' => 'evaluation_due', 'level' => $ended ? 'red' : 'amber', 'label' => $ended ? 'Deployment ended, no evaluation yet' : 'No evaluation yet, deployment ends soon'];
            }

            $projection = self::project($d->status, $d->start_date, $d->end_date, $required, $hours, $dayHours, $today);
            $hoursMet = $required > 0 && $hours >= $required;
            $group = self::classify($d->status, $hoursMet, $flags, $missed, $projection);
            $cal = self::calendar($d->status, $d->start_date, $d->end_date, $byDate, $today, $calStart);
            $profile = $profiles->get($d->intern_id);
            $t = $tasks->get($d->id);

            return [
                'deployment_id' => $d->id,
                'intern_id' => $d->intern_id,
                'intern_name' => self::nameOf($d->intern),
                'intern_email' => $d->intern?->email,
                'student_number' => $profile?->student_number,
                'course' => $profile?->course,
                'year_level' => $profile?->year_level,
                'company_id' => $d->company_id,
                'company_name' => $d->company?->company_name,
                'supervisor_name' => self::nameOf($d->supervisor),
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
                'has_evaluation' => $eval !== null,
                'latest_evaluation_score' => $eval?->overall_score !== null ? (float) $eval->overall_score : null,
                'latest_evaluation_date' => $eval?->evaluation_date?->toDateString(),
                'journal_entries' => (int) ($journal[$d->id] ?? 0),
                'tasks_total' => (int) ($t->total ?? 0),
                'tasks_done' => (int) ($t->done ?? 0),
                'last_clock_in_at' => $lastClockIn?->toIso8601String(),
                'flags' => $flags,
                'needs_attention' => count($flags) > 0,
                'status_group' => $group['group'],
                'status_group_label' => $group['label'],
                'status_reasons' => $group['reasons'],
                'projection' => $projection,
                'calendar' => [
                    'start' => $calStart->toDateString(),
                    'codes' => implode('', array_column($cal, 'code')),
                    'hours' => array_map(fn ($c) => $c['hours'] !== null ? round($c['hours'], 1) : null, $cal),
                ],
                '_eval_due' => $evalDue,
                '_ended_days' => ($isActive && $d->end_date && $d->end_date->lt($today)) ? (int) $d->end_date->diffInDays($today) : null,
                '_created_at' => $d->created_at,
            ];
        })->values();

        // At risk first, then needs attention, on track, completed; most flags first within a group.
        $order = array_flip(['at_risk', 'needs_attention', 'on_track', 'completed', 'inactive']);

        return $rows->sort(function ($a, $b) use ($order) {
            return [$order[$a['status_group']] ?? 9, -count($a['flags']), strtolower((string) $a['intern_name'])]
                <=> [$order[$b['status_group']] ?? 9, -count($b['flags']), strtolower((string) $b['intern_name'])];
        })->values();
    }

    /** @return array{at_risk:int,needs_attention:int,on_track:int,completed:int,total:int} */
    public static function groupCounts(Collection $rows): array
    {
        $counts = array_fill_keys(self::GROUPS, 0);
        foreach ($rows as $r) {
            if (isset($counts[$r['status_group']])) {
                $counts[$r['status_group']]++;
            }
        }

        return $counts + ['total' => array_sum($counts)];
    }

    public static function publicRow(array $row): array
    {
        return array_filter($row, fn ($k) => !str_starts_with($k, '_'), ARRAY_FILTER_USE_KEY);
    }

    /** Full 28-day calendar with dates and per-day wording (tooltips / aria-labels). */
    public static function expandCalendar(array $calendar): array
    {
        $start = Carbon::parse($calendar['start']);
        $words = ['P' => 'Present', 'M' => 'Waiting for approval', 'X' => 'Rejected', 'A' => 'Absent', 'O' => 'No work day', 'F' => 'Not yet'];
        $days = [];
        foreach (str_split($calendar['codes']) as $i => $code) {
            $d = $start->copy()->addDays($i);
            $h = $calendar['hours'][$i] ?? null;
            $days[] = [
                'date' => $d->toDateString(),
                'code' => $code,
                'hours' => $h,
                'label' => $d->format('D, M j') . ': ' . $words[$code] . ($h !== null ? ", {$h} h" : ''),
            ];
        }

        return $days;
    }
}
