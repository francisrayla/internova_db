<?php

namespace App\Console\Commands;

use App\Models\SubscriptionPlan;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * One-off cleanup for duplicated subscription plans (same name, several ids).
 *
 * For every group of plans with the same normalized name the lowest id is kept.
 * Every foreign key that points at subscription_plans (discovered from the
 * schema, so a future column is covered too) is repointed to the kept id inside
 * one transaction, then the duplicates are deleted. Safe to re-run: with no
 * duplicates left it changes nothing. --pretend only prints the plan.
 */
class DedupePlansCommand extends Command
{
    protected $signature = 'plans:dedupe {--pretend : Show what would change without changing anything}';

    protected $description = 'Merge duplicate subscription plans (same name) into the lowest id and repoint references';

    public function handle(): int
    {
        $pretend = (bool) $this->option('pretend');
        $references = $this->references();

        $groups = SubscriptionPlan::orderBy('id')->get()
            ->groupBy(fn ($p) => SubscriptionPlan::normalizeName($p->name))
            ->filter(fn ($g) => $g->count() > 1);

        if ($groups->isEmpty()) {
            $this->info('No duplicate plans found. Nothing to do.');

            return self::SUCCESS;
        }

        $rows = [];
        $work = [];
        foreach ($groups as $plans) {
            $kept = $plans->first();
            foreach ($plans->skip(1) as $dup) {
                $counts = [];
                foreach ($references as [$table, $column]) {
                    $counts["{$table}.{$column}"] = DB::table($table)->where($column, $dup->id)->count();
                }
                $differs = (float) $dup->monthly_price !== (float) $kept->monthly_price || (float) $dup->yearly_price !== (float) $kept->yearly_price;
                $work[] = [$kept, $dup];
                $rows[] = [
                    $kept->name,
                    $kept->id,
                    $dup->id,
                    collect($counts)->filter()->map(fn ($n, $k) => "{$k}={$n}")->implode(', ') ?: 'none',
                    $differs ? 'PRICES DIFFER from kept plan' : 'same prices',
                ];
            }
        }

        $this->table(['Plan', 'Kept id', 'Duplicate id', 'References repointed', 'Note'], $rows);

        if ($pretend) {
            $this->warn('Pretend mode: nothing was changed.');

            return self::SUCCESS;
        }

        DB::transaction(function () use ($work, $references) {
            foreach ($work as [$kept, $dup]) {
                foreach ($references as [$table, $column]) {
                    DB::table($table)->where($column, $dup->id)->update([$column => $kept->id]);
                }
                $dup->delete();
            }
        });

        $this->info(count($work) . ' duplicate plan(s) merged.');

        return self::SUCCESS;
    }

    /** @return array<int, array{0:string,1:string}> [table, column] pairs that reference subscription_plans */
    private function references(): array
    {
        // One information_schema query (MySQL) instead of inspecting every table.
        $rows = DB::select(
            'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME = ?',
            [DB::getDatabaseName(), 'subscription_plans']
        );
        $found = [];
        foreach ($rows as $row) {
            $found[] = [$row->t, $row->c];
        }

        return $found;
    }
}
