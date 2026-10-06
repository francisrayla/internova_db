<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\DeanProfile;
use App\Models\School;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Data for the Monday "weekly summary" email, and who should get it.
 * "Last week" = the Monday-Sunday week that just ended.
 */
class DeanWeeklySummaryService
{
    /** Active Deans who have the weekly email on, at schools with an active subscription. */
    public static function recipients(): Collection
    {
        $roleId = SchoolStaff::roleId('dean');
        if (!$roleId) {
            return collect();
        }

        return User::with('school')->where('role_id', $roleId)->where('status', 'active')
            ->whereNotNull('password')->whereNull('email_bounced_at')->whereNotNull('school_id')->get()
            ->filter(function (User $dean) {
                $school = $dean->school;
                if (!$school || $school->is_suspended) {
                    return false;
                }
                $profile = DeanProfile::where('user_id', $dean->id)->first();
                if ($profile && !$profile->weekly_summary_email) {
                    return false;
                }

                return $school->currentSubscription()?->effectiveStatus() === 'active';
            })->values();
    }

    public static function build(User $dean, ?Carbon $now = null): array
    {
        $now = $now ?? now();
        $school = School::findOrFail($dean->school_id);
        $rows = InternMonitoringService::rows($school);
        $groups = InternMonitoringService::groupCounts($rows);
        $weekStart = $now->copy()->startOfWeek(Carbon::MONDAY)->subWeek()->startOfDay();
        $weekEnd = $weekStart->copy()->addDays(6);

        $ids = $rows->pluck('deployment_id')->all();
        $hours = 0.0;
        if ($ids) {
            Attendance::whereIn('deployment_id', $ids)->where('status', 'approved')->whereNotNull('clock_out')
                ->whereBetween('attendance_date', [$weekStart->toDateString(), $weekEnd->toDateString()])
                ->get(['clock_in', 'clock_out'])
                ->each(function ($a) use (&$hours) {
                    $hours += max(0, $a->clock_in->diffInMinutes($a->clock_out)) / 60;
                });
        }

        $scorecard = CoordinatorInsightsService::scorecard($school, $rows);
        $coordinator = SchoolStaff::coordinator($school->id);
        $activity = CoordinatorInsightsService::activityChart($school, $coordinator);
        $stale = collect($scorecard['metrics'])->firstWhere('key', 'backlog')['stale'] ?? 0;
        $base = rtrim((string) config('app.frontend_url'), '/');

        return [
            'school_name' => $school->school_name,
            'dean_name' => InternMonitoringService::nameOf($dean) ?: 'there',
            'week_label' => $weekStart->format('M j') . ' to ' . $weekEnd->format('M j, Y'),
            'groups' => $groups,
            'hours_rendered' => round($hours, 1),
            'at_risk_names' => $rows->where('status_group', 'at_risk')->pluck('intern_name')->filter()->take(5)->values()->all(),
            'attention_now' => $groups['at_risk'] + $groups['needs_attention'],
            'stale_documents' => $stale,
            'coordinator_name' => InternMonitoringService::nameOf($coordinator),
            'coordinator_actions_last_week' => $activity['last_week'],
            'verdicts' => collect($scorecard['metrics'])->map(fn ($m) => [
                'title' => $m['title'], 'display' => $m['display'], 'verdict' => $m['verdict']['label'], 'tone' => $m['verdict']['tone'],
            ])->all(),
            'links' => [
                'overview' => $base . '/dean/dashboard',
                'interns' => $base . '/dean/interns',
                'coordinator' => $base . '/dean/coordinator',
                'settings' => $base . '/dean/account',
            ],
        ];
    }
}
