<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\DeploymentTransfer;
use App\Models\InternshipDeployment;
use App\Models\SupervisorProfile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Where an intern has been, built from deployment_transfers. A deployment is
 * edited in place when the intern is reassigned, so this is the only record of
 * the earlier companies.
 *
 * Segment boundaries: a transfer with transferred_on = Oct 20 means the earlier
 * placement ran until Oct 19 and the new one starts Oct 20.
 */
class DeploymentHistoryService
{
    /**
     * Placements in date order. Empty when the deployment was never transferred
     * (callers then show nothing / the plain current company).
     *
     * @return array<int, array{company_id:?int,company_name:?string,supervisor_name:?string,start_date:?string,end_date:?string,start_label:?string,end_label:?string,range:string,hours:float,is_current:bool,status:string}>
     */
    public static function segments(InternshipDeployment $d): array
    {
        $transfers = $d->transfers()->with(['fromCompany:id,company_name', 'toCompany:id,company_name'])->get();
        if ($transfers->isEmpty()) {
            return [];
        }
        $d->loadMissing('company');

        // Define each placement as [company, supervisor, start, end].
        $places = [];
        $first = $transfers->first();
        $places[] = [$first->from_company_id, $first->fromCompany?->company_name, InternMonitoringService::nameOf($first->fromSupervisor), $d->start_date, $first->transferred_on->copy()->subDay()];
        foreach ($transfers as $i => $t) {
            $next = $transfers->get($i + 1);
            $places[] = [
                $t->to_company_id, $t->toCompany?->company_name, InternMonitoringService::nameOf($t->toSupervisor),
                $t->transferred_on, $next ? $next->transferred_on->copy()->subDay() : null,
            ];
        }

        $att = Attendance::where('deployment_id', $d->id)->where('status', 'approved')
            ->whereNotNull('clock_in')->whereNotNull('clock_out')
            ->get(['attendance_date', 'clock_in', 'clock_out']);

        // Supervisors are per company now, not per intern: each placement lists
        // the active supervisors its company has today.
        $names = self::supervisorNamesByCompany(array_merge([$d->company_id], array_column($places, 0)));
        $out = [];
        $last = count($places) - 1;
        foreach ($places as $i => [$cid, $cname, $sname, $start, $end]) {
            $isCurrent = $i === $last;
            if ($isCurrent) {
                // The current placement mirrors the deployment itself.
                $cid = $d->company_id;
                $cname = $d->company?->company_name;
                                $end = $d->status === 'active' ? null : $d->end_date;
            }
            $sname = $names[$cid] ?? null;
            $from = $start?->toDateString();
            $to = $end?->toDateString();
            $hours = $att->filter(function ($a) use ($i, $from, $to) {
                $day = $a->attendance_date ? $a->attendance_date->toDateString() : \App\Support\LocalTime::date($a->clock_in);

                return ($i === 0 || $from === null || $day >= $from) && ($to === null || $day <= $to);
            })->sum(fn ($a) => max(0, $a->clock_in->diffInMinutes($a->clock_out)) / 60);

            $out[] = [
                'company_id' => $cid,
                'company_name' => $cname,
                'supervisor_name' => $sname,
                'start_date' => $from,
                'end_date' => $to,
                'start_label' => $start?->format('M j, Y'),
                'end_label' => $end?->format('M j, Y'),
                'range' => self::range($start, $end, $isCurrent && $d->status === 'active'),
                'hours' => round($hours, 1),
                'is_current' => $isCurrent,
                'status' => $isCurrent ? $d->status : 'moved',
            ];
        }

        return $out;
    }

    /**  array<int,string> company_id => "A, B" (active supervisors only) */
    public static function supervisorNamesByCompany(array $companyIds): array
    {
        $companyIds = array_values(array_unique(array_filter($companyIds)));
        if (!$companyIds) {
            return [];
        }

        return SupervisorProfile::with('user')->whereIn('company_id', $companyIds)
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))->get()
            ->groupBy('company_id')
            ->map(fn ($g) => $g->map(fn ($p) => InternMonitoringService::nameOf($p->user))->filter()->implode(', '))
            ->filter()->all();
    }

    public static function range(?Carbon $start, ?Carbon $end, bool $present): string
    {
        if ($present) {
            return ($start ? $start->format('M j, Y') : '') . ' – present';
        }
        if ($start && $end) {
            return $start->year === $end->year ? $start->format('M j') . ' – ' . $end->format('M j, Y') : $start->format('M j, Y') . ' – ' . $end->format('M j, Y');
        }

        return $end ? 'until ' . $end->format('M j, Y') : ($start ? 'from ' . $start->format('M j, Y') : '');
    }

    /** Company in effect on a date (Y-m-d), from segments(); null when there is no history. */
    public static function companyOn(array $segments, ?string $day): ?string
    {
        if (!$segments || !$day) {
            return null;
        }
        foreach ($segments as $i => $s) {
            $afterStart = $i === 0 || $s['start_date'] === null || $day >= $s['start_date'];
            $beforeEnd = $s['end_date'] === null || $day <= $s['end_date'];
            if ($afterStart && $beforeEnd) {
                return $s['company_name'];
            }
        }

        return null;
    }

    /**
     * "Moved from ABC Technologies" for many deployments in ONE query.
     *
     * @param  Collection<int, InternshipDeployment>|array<int,int>  $deployments  models or ids
     * @return array<int, array{company_name:?string,transferred_on:string}>  keyed by deployment id (latest move)
     */
    public static function movedFrom(Collection|array $deployments): array
    {
        $ids = collect($deployments)->map(fn ($d) => $d instanceof InternshipDeployment ? $d->id : $d)->all();
        if (!$ids) {
            return [];
        }
        $out = [];
        DeploymentTransfer::with('fromCompany:id,company_name')->whereIn('deployment_id', $ids)
            ->orderBy('transferred_on')->orderBy('id')->get()
            ->each(function ($t) use (&$out) {
                $out[$t->deployment_id] = ['company_name' => $t->fromCompany?->company_name, 'transferred_on' => $t->transferred_on->toDateString()];
            });

        return $out;
    }
}
