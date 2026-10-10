<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Company;
use App\Models\Document;
use App\Models\EvaluationCriterion;
use App\Models\NarrativeTemplate;
use App\Models\School;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * How well the school's coordinator is doing, in plain numbers:
 * scorecard, setup checklist and the 4-week activity chart.
 *
 * VERDICT THRESHOLDS (Good / Watch / Needs attention; "none" = no data yet):
 *   review_time   average days from upload to approve/reject (reviews in the last 90 days):
 *                 Good <= 2, Watch <= 5, else Needs attention.
 *                 reviewed_at is used when set; older rows are estimated from updated_at.
 *   backlog       documents waiting longer than 3 days: Good 0, Watch 1-3, Needs attention 4+.
 *                 (Also shows total waiting now vs 4 weeks ago.)
 *   supervisor    % of active interns with a supervisor: Good >= 95, Watch >= 80, else Needs attention.
 *   evaluated     % evaluated of interns due or ended (completed, or ends within 14 days):
 *                 Good >= 80, Watch >= 50, else Needs attention.
 *   invitations   % of intern/supervisor accounts that were set up (password chosen):
 *                 Good >= 80, Watch >= 50, else Needs attention.
 */
class CoordinatorInsightsService
{
    public const REVIEW_DAYS_GOOD = 2;
    public const REVIEW_DAYS_WATCH = 5;
    public const REVIEW_LOOKBACK_DAYS = 90;
    public const STALE_DOCUMENT_DAYS = 3;
    public const BACKLOG_WATCH_MAX = 3;
    public const PCT_SUPERVISOR = [95, 80];
    public const PCT_EVALUATED = [80, 50];
    public const PCT_INVITES = [80, 50];

    private static function verdict(?string $key): array
    {
        return match ($key) {
            'good' => ['key' => 'good', 'label' => 'Good', 'tone' => 'green'],
            'watch' => ['key' => 'watch', 'label' => 'Watch', 'tone' => 'amber'],
            'attention' => ['key' => 'attention', 'label' => 'Needs attention', 'tone' => 'red'],
            default => ['key' => 'none', 'label' => 'No data yet', 'tone' => 'slate'],
        };
    }

    private static function byPercent(?float $pct, array $limits): array
    {
        if ($pct === null) {
            return self::verdict(null);
        }

        return self::verdict($pct >= $limits[0] ? 'good' : ($pct >= $limits[1] ? 'watch' : 'attention'));
    }

    private static function pct(int $num, int $den): ?int
    {
        return $den > 0 ? (int) round($num / $den * 100) : null;
    }

    /** @param Collection<int, array> $rows InternMonitoringService::rows() */
    public static function scorecard(School $school, Collection $rows): array
    {
        $now = now();
        $deploymentIds = $rows->pluck('deployment_id')->all();
        $docs = $deploymentIds
            ? Document::whereIn('deployment_id', $deploymentIds)->get(['id', 'status', 'created_at', 'updated_at', 'reviewed_at'])
            : collect();

        // 1. Review time
        $since = $now->copy()->subDays(self::REVIEW_LOOKBACK_DAYS);
        $durations = [];
        $estimated = 0;
        foreach ($docs->where('status', '!=', 'pending') as $doc) {
            $at = $doc->reviewed_at ?? $doc->updated_at;
            if ($at->lt($since)) {
                continue;
            }
            if (!$doc->reviewed_at) {
                $estimated++;
            }
            $durations[] = max(0, $doc->created_at->diffInSeconds($at) / 86400);
        }
        $avg = $durations ? round(array_sum($durations) / count($durations), 1) : null;
        $reviewTime = [
            'key' => 'review_time',
            'title' => 'Time to review a document',
            'value' => $avg,
            'display' => $avg === null ? 'No reviews yet' : $avg . ($avg == 1 ? ' day' : ' days'),
            'detail' => $avg === null
                ? 'Shows up after the coordinator reviews a document.'
                : 'Average over ' . count($durations) . ' review' . (count($durations) === 1 ? '' : 's') . ' in the last ' . self::REVIEW_LOOKBACK_DAYS . ' days' . ($estimated ? " ({$estimated} estimated)" : '') . '.',
            'verdict' => $avg === null ? self::verdict(null) : self::verdict($avg <= self::REVIEW_DAYS_GOOD ? 'good' : ($avg <= self::REVIEW_DAYS_WATCH ? 'watch' : 'attention')),
        ];

        // 2. Backlog now vs 4 weeks ago
        $pending = $docs->where('status', 'pending');
        $backlogNow = $pending->count();
        $stale = $pending->filter(fn ($d) => $d->created_at->lt($now->copy()->subDays(self::STALE_DOCUMENT_DAYS)))->count();
        $then = $now->copy()->subDays(28);
        $backlogThen = $docs->filter(function ($d) use ($then) {
            if ($d->created_at->gt($then)) {
                return false;
            }

            return $d->status === 'pending' || ($d->reviewed_at ?? $d->updated_at)->gt($then);
        })->count();
        $trend = $backlogNow < $backlogThen ? 'smaller' : ($backlogNow > $backlogThen ? 'bigger' : 'the same');
        $backlog = [
            'key' => 'backlog',
            'title' => 'Documents waiting for review',
            'value' => $backlogNow,
            'display' => $backlogNow . ($backlogNow === 1 ? ' waiting' : ' waiting'),
            'detail' => "4 weeks ago: {$backlogThen}. The pile is {$trend}" . ($stale ? "; {$stale} " . ($stale === 1 ? 'has' : 'have') . ' waited over ' . self::STALE_DOCUMENT_DAYS . ' days.' : '.'),
            'previous' => $backlogThen,
            'stale' => $stale,
            'verdict' => self::verdict($stale === 0 ? 'good' : ($stale <= self::BACKLOG_WATCH_MAX ? 'watch' : 'attention')),
        ];

        // 3. Active interns with a supervisor
        $active = $rows->where('status', 'active')->where('is_finished', false);
        $withSup = $active->filter(fn ($r) => !empty($r['supervisor_name']))->count();
        $supPct = self::pct($withSup, $active->count());
        $supervisor = [
            'key' => 'supervisor',
            'title' => 'Active interns with a supervisor',
            'value' => $supPct,
            'display' => $supPct === null ? 'No active interns' : "{$supPct}%",
            'detail' => $active->count() ? "{$withSup} of {$active->count()} active interns have a supervisor." : 'Shows up once interns are deployed.',
            'verdict' => self::byPercent($supPct, self::PCT_SUPERVISOR),
        ];

        // 4. Evaluated (of those due or ended)
        $due = $rows->filter(fn ($r) => $r['status'] !== 'inactive' && ($r['is_finished']
            || ($r['end_date'] && Carbon::parse($r['end_date'])->lte(\App\Support\LocalTime::todayDate()->addDays(InternMonitoringService::EVALUATION_WINDOW_DAYS)))));
        $done = $due->where('has_evaluation', true)->count();
        $evalPct = self::pct($done, $due->count());
        $evaluated = [
            'key' => 'evaluated',
            'title' => 'Interns evaluated',
            'value' => $evalPct,
            'display' => $evalPct === null ? 'None due yet' : "{$evalPct}%",
            'detail' => $due->count() ? "{$done} of {$due->count()} interns who are finishing or finished have an evaluation." : 'Counts interns whose deployment is completed or ends within 14 days.',
            'verdict' => self::byPercent($evalPct, self::PCT_EVALUATED),
        ];

        // 5. Invitations accepted
        $roleIds = array_filter([SchoolStaff::roleId('intern'), SchoolStaff::roleId('supervisor')]);
        $accounts = User::where('school_id', $school->id)->whereIn('role_id', $roleIds)->where('status', '!=', 'inactive')->get(['id', 'password']);
        $accepted = $accounts->filter(fn ($u) => $u->password !== null)->count();
        $invPct = self::pct($accepted, $accounts->count());
        $invitations = [
            'key' => 'invitations',
            'title' => 'Invitations accepted',
            'value' => $invPct,
            'display' => $invPct === null ? 'No invitations yet' : "{$invPct}%",
            'detail' => $accounts->count() ? "{$accepted} of {$accounts->count()} interns and supervisors have set up their account." : 'Shows up once interns or supervisors are invited.',
            'verdict' => self::byPercent($invPct, self::PCT_INVITES),
        ];

        return [
            'metrics' => [$reviewTime, $backlog, $supervisor, $evaluated, $invitations],
            'help' => [
                'review_time' => 'Counted from upload to approve/reject. Reviews made before this feature was added are estimated from the last time the document changed.',
                'thresholds' => [
                    'Time to review: Good up to 2 days, Watch up to 5 days.',
                    'Waiting for review: Good when nothing waited more than 3 days, Watch for 1 to 3, Needs attention for 4 or more.',
                    'Supervisors: Good at 95% or more, Watch at 80% or more.',
                    'Evaluated: Good at 80% or more, Watch at 50% or more.',
                    'Invitations: Good at 80% or more, Watch at 50% or more.',
                ],
            ],
        ];
    }

    /** @param Collection<int, array> $rows */
    public static function checklist(School $school, Collection $rows): array
    {
        $companies = Company::where('school_id', $school->id)->count();
        $supRole = SchoolStaff::roleId('supervisor');
        $supervisors = User::where('school_id', $school->id)->where('role_id', $supRole)->where('status', '!=', 'inactive')->get(['id', 'password']);
        $supActive = $supervisors->filter(fn ($u) => $u->password !== null)->count();
        $deployed = $rows->where('status', '!=', 'inactive')->count();
        $active = $rows->where('status', 'active')->where('is_finished', false);
        $noSup = $active->filter(fn ($r) => empty($r['supervisor_name']))->count();
        $criteria = EvaluationCriterion::where('school_id', $school->id)->where('status', 'active')->count();
        $tpl = NarrativeTemplate::where('school_id', $school->id)->first();
        $filled = fn ($v) => is_array($v) && collect($v)->contains(fn ($x) => is_string($x) ? trim($x) !== '' : !empty($x));
        $tplOk = $tpl && $filled($tpl->letterhead) && $filled($tpl->cover);

        $items = [
            ['key' => 'companies', 'label' => 'Partner companies added', 'ok' => $companies > 0,
                'hint' => $companies > 0 ? "{$companies} " . ($companies === 1 ? 'company' : 'companies') . ' added.' : 'Add the companies where interns will be deployed.'],
            ['key' => 'supervisors', 'label' => 'Supervisors invited and active', 'ok' => $supActive > 0,
                'hint' => $supActive > 0 ? "{$supActive} of {$supervisors->count()} supervisors are active." : ($supervisors->count() ? 'Supervisors were invited but nobody has accepted yet.' : 'Invite at least one supervisor.')],
            ['key' => 'interns', 'label' => 'Interns deployed', 'ok' => $deployed > 0,
                'hint' => $deployed > 0 ? "{$deployed} " . ($deployed === 1 ? 'intern' : 'interns') . ' deployed.' : 'Invite interns and assign them to a company.'],
            ['key' => 'intern_supervisors', 'label' => 'Every active intern has a supervisor', 'ok' => $active->count() > 0 && $noSup === 0,
                'hint' => $active->count() === 0 ? 'No active interns yet.' : ($noSup === 0 ? 'All active interns have a supervisor.' : "{$noSup} active " . ($noSup === 1 ? 'intern has' : 'interns have') . ' no supervisor.')],
            ['key' => 'criteria', 'label' => 'Evaluation criteria set', 'ok' => $criteria > 0,
                'hint' => $criteria > 0 ? "{$criteria} active criteria." : 'Add the criteria supervisors will score interns on.'],
            ['key' => 'narrative', 'label' => 'Narrative report letterhead and cover set', 'ok' => (bool) $tplOk,
                'hint' => $tplOk ? 'Letterhead and cover are filled in.' : 'Fill in the letterhead and cover page so reports use the school format.'],
        ];

        return ['items' => $items, 'done' => collect($items)->where('ok', true)->count(), 'total' => count($items)];
    }

    /** Coordinator actions per day for the last 4 weeks (Monday first, current week last). */
    public static function activityChart(School $school, ?User $coordinator): array
    {
        $today = \App\Support\LocalTime::todayDate();
        $start = InternMonitoringService::calendarStart($today);
        $counts = [];
        if ($coordinator) {
            ActivityLog::where('user_id', $coordinator->id)->where('school_id', $school->id)
                ->where('created_at', '>=', $start)->get(['created_at'])
                ->each(function ($a) use (&$counts) {
                    $k = \App\Support\LocalTime::date($a->created_at);
                    $counts[$k] = ($counts[$k] ?? 0) + 1;
                });
        }

        $days = [];
        $weeks = [];
        for ($i = 0; $i < 28; $i++) {
            $d = $start->copy()->addDays($i);
            $n = $counts[$d->toDateString()] ?? 0;
            $days[] = ['date' => $d->toDateString(), 'count' => $n, 'weekend' => $d->isWeekend(), 'future' => $d->gt($today), 'label' => $d->format('D, M j') . ": {$n} " . ($n === 1 ? 'action' : 'actions')];
            $w = intdiv($i, 7);
            $weeks[$w] = ($weeks[$w] ?? 0) + $n;
        }
        $weekList = [];
        foreach ($weeks as $w => $total) {
            $from = $start->copy()->addWeeks($w);
            $weekList[] = ['label' => $from->format('M j') . ' - ' . $from->copy()->addDays(6)->format('M j'), 'total' => $total];
        }
        $this_ = $weeks[3];
        $last = $weeks[2];
        $summary = "Coordinator actions per week, oldest to newest: " . implode(', ', array_map(fn ($w) => "{$w['label']}: {$w['total']}", $weekList))
            . ". This week {$this_}, last week {$last}.";

        return [
            'days' => $days,
            'weeks' => $weekList,
            'this_week' => $this_,
            'last_week' => $last,
            'max' => max(1, max(array_column($days, 'count'))),
            'summary' => $summary,
        ];
    }
}
