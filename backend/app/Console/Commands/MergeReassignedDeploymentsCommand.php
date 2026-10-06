<?php

namespace App\Console\Commands;

use App\Services\DeploymentMergeBackfill;
use Illuminate\Console\Command;

class MergeReassignedDeploymentsCommand extends Command
{
    protected $signature = 'deployments:merge-reassigned {--pretend : Only show what would be merged}';

    protected $description = 'Merge interns who were reassigned the old way (two deployments) into one deployment with a transfer record';

    public function handle(): int
    {
        $report = DeploymentMergeBackfill::run((bool) $this->option('pretend'));
        if (!$report) {
            $this->info('Nothing to merge.');

            return self::SUCCESS;
        }
        $this->table(['Action', 'Original #', 'Duplicate #', 'Why'], array_map(fn ($r) => [$r['action'], $r['older'], $r['newer'], $r['reason']], $report));

        return self::SUCCESS;
    }
}
