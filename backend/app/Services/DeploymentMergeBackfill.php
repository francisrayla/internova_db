<?php

namespace App\Services;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Data fix for reassignments made the OLD way, when reassignIntern() closed the
 * deployment as "completed" and created a second one (so the intern appeared
 * twice). Each such pair is MERGED back into the ORIGINAL (older) deployment
 * and a deployment_transfers row records the move; the duplicate is deleted.
 *
 * RULE (evidence only). A (older) and B (newer) are merged when ALL hold:
 *   1. same intern and same school; B is the next deployment after A (the highest id below B);
 *   2. A.status = 'completed' (what the old code wrote) and A.company_id != B.company_id;
 *   3. at least ONE proof that B replaced A:
 *        a. A.updated_at within 2 s of B.created_at (the old code closed A and
 *           created B in one transaction);
 *        b. an activity_logs row from reassignIntern (module 'Interns', action
 *           'Reassigned intern', same school) with description exactly
 *           "<intern name> moved from <A company> to <B company>." within 120 s of B.created_at.
 * Anything else is SKIPPED and logged (a genuine completion followed by a new
 * placement stays as it is). A -> B -> C chains merge into A in order.
 *
 * MERGE: every row pointing at B (attendances, daily_activities, tasks, task_assignees,
 * documents, evaluations, B's own transfers) moves to A; notification links /interns/B
 * become /interns/A; A takes B's company, supervisor, coordinator, status, required_hours
 * and end_date (start_date stays the original); one deployment_transfers row is written
 * (transferred_on = B.start_date, or B's creation date when that is before A started);
 * B is deleted. One transaction per pair. Idempotent: a merged pair is gone, so a second
 * run finds nothing. $pretend writes nothing.
 *
 * @return array<int, array{action:string,older:int,newer:int,reason:string}>
 */
class DeploymentMergeBackfill
{
    // tasks is listed for older databases; it is skipped when the column no longer exists.
    private const TABLES_BY_DEPLOYMENT_ID = ['attendances', 'daily_activities', 'tasks', 'documents', 'evaluations'];

    public static function run(bool $pretend = false): array
    {
        $report = [];
        $mergedInto = []; // duplicate id => original id (so A -> B -> C resolves to A)

        $candidates = DB::table('internship_deployments as b')
            ->join('internship_deployments as a', function ($j) {
                $j->on('a.intern_id', '=', 'b.intern_id')->on('a.school_id', '=', 'b.school_id')->whereColumn('a.id', '<', 'b.id');
            })
            ->where('a.status', 'completed')
            ->select('b.id as b_id')->distinct()->orderBy('b.id')->pluck('b_id');

        foreach ($candidates as $bId) {
            $b = DB::table('internship_deployments')->find($bId);
            $prev = $b ? DB::table('internship_deployments')
                ->where('intern_id', $b->intern_id)->where('school_id', $b->school_id)
                ->where('id', '<', $b->id)->orderByDesc('id')->first() : null;
            if (!$prev) {
                continue;
            }
            // The row directly before B, or the original it was already merged into.
            $a = DB::table('internship_deployments')->find($mergedInto[$prev->id] ?? $prev->id);

            [$ok, $reason] = self::check($prev, $b);
            if (!$ok) {
                if ($reason !== 'not completed') {
                    Log::warning("deployments merge skipped {$a->id}/{$b->id}: {$reason}");
                    $report[] = ['action' => 'skipped', 'older' => $a->id, 'newer' => $b->id, 'reason' => $reason];
                }
                continue;
            }

            $report[] = ['action' => $pretend ? 'would merge' : 'merged', 'older' => $a->id, 'newer' => $b->id, 'reason' => $reason];
            if (!$pretend) {
                DB::transaction(fn () => self::merge($a, $b));
            }
            $mergedInto[$b->id] = $a->id;
        }

        return $report;
    }

    /**
     * @param  object  $prev  the deployment row directly before $b (as the old code left it)
     * @return array{0:bool,1:string}
     */
    private static function check(object $prev, object $b): array
    {
        // A merged earlier link of a chain is 'completed' in the data only if the old code closed it; a
        // row we already merged is gone, so $prev here is always a row as the old code left it.
        if ($prev->status !== 'completed') {
            return [false, 'not completed'];
        }
        if ($prev->company_id === $b->company_id) {
            return [false, 'same company on both rows, not provably a reassignment'];
        }
        $bCreated = Carbon::parse($b->created_at);
        if ($prev->updated_at && abs(Carbon::parse($prev->updated_at)->diffInSeconds($bCreated, false)) <= 2) {
            return [true, 'closed at the moment the newer one was created'];
        }
        $name = DB::table('users')->where('id', $b->intern_id)->value('name');
        $old = DB::table('companies')->where('id', $prev->company_id)->value('company_name');
        $new = DB::table('companies')->where('id', $b->company_id)->value('company_name');
        $logged = $name !== null && $old !== null && $new !== null && DB::table('activity_logs')
            ->where('module', 'Interns')->where('action', 'Reassigned intern')->where('school_id', $b->school_id)
            ->where('description', "{$name} moved from {$old} to {$new}.")
            ->whereBetween('created_at', [$bCreated->copy()->subSeconds(120), $bCreated->copy()->addSeconds(120)])
            ->exists();

        return $logged ? [true, 'reassign activity log entry'] : [false, 'no evidence of a reassignment'];
    }

    private static function merge(object $a, object $b): void
    {
        // Re-read A: an earlier merge in the same chain may have changed it.
        $a = DB::table('internship_deployments')->find($a->id);

        $approved = DB::table('attendances')->where('deployment_id', $a->id)->where('status', 'approved')
            ->whereNotNull('clock_in')->whereNotNull('clock_out')->get(['clock_in', 'clock_out'])
            ->sum(fn ($r) => max(0, Carbon::parse($r->clock_in)->diffInMinutes(Carbon::parse($r->clock_out))) / 60);

        $aStart = Carbon::parse($a->start_date)->startOfDay();
        $movedOn = Carbon::parse($b->start_date)->startOfDay();
        if ($movedOn->lt($aStart)) {
            $movedOn = Carbon::parse($b->created_at)->startOfDay();
        }
        if ($movedOn->lt($aStart)) {
            $movedOn = $aStart;
        }

        // The same task assigned on both rows: keep A's, drop B's duplicate first.
        DB::table('task_assignees')->where('deployment_id', $b->id)
            ->whereIn('task_id', DB::table('task_assignees')->where('deployment_id', $a->id)->select('task_id'))->delete();
        DB::table('task_assignees')->where('deployment_id', $b->id)->update(['deployment_id' => $a->id]);
        foreach (self::TABLES_BY_DEPLOYMENT_ID as $table) {
            if (!Schema::hasColumn($table, 'deployment_id')) {
                continue;
            }
            DB::table($table)->where('deployment_id', $b->id)->update(['deployment_id' => $a->id]);
        }
        DB::table('deployment_transfers')->where('deployment_id', $b->id)->update(['deployment_id' => $a->id]);

        DB::table('notifications')->where('link', 'like', "%/interns/{$b->id}%")->get(['id', 'link'])->each(function ($n) use ($a, $b) {
            $new = preg_replace('#/interns/' . $b->id . '(?=$|[/?\\#])#', '/interns/' . $a->id, $n->link);
            if ($new !== $n->link) {
                DB::table('notifications')->where('id', $n->id)->update(['link' => $new]);
            }
        });

        DB::table('deployment_transfers')->insert([
            'deployment_id' => $a->id,
            'from_company_id' => $a->company_id,
            'from_supervisor_id' => $a->supervisor_id,
            'to_company_id' => $b->company_id,
            'to_supervisor_id' => $b->supervisor_id,
            'transferred_on' => $movedOn->toDateString(),
            'approved_hours_at_transfer' => round($approved, 2),
            'transferred_by' => $b->coordinator_id,
            'note' => 'Merged from duplicate deployment #' . $b->id . ' (reassigned before in-place transfers existed)',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // The merged row is the newer placement's state, keeping the ORIGINAL start date.
        DB::table('internship_deployments')->where('id', $a->id)->update([
            'company_id' => $b->company_id,
            'supervisor_id' => $b->supervisor_id,
            'coordinator_id' => $b->coordinator_id ?? $a->coordinator_id,
            'status' => $b->status,
            'required_hours' => $b->required_hours,
            'end_date' => $b->end_date,
            // Keep B's timestamp: in an A -> B -> C chain it is the evidence that C replaced this row.
            'updated_at' => $b->updated_at,
        ]);
        DB::table('internship_deployments')->where('id', $b->id)->delete();
    }
}
