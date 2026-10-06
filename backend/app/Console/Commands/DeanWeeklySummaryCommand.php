<?php

namespace App\Console\Commands;

use App\Mail\DeanWeeklySummary;
use App\Services\DeanWeeklySummaryService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Mail;

class DeanWeeklySummaryCommand extends Command
{
    protected $signature = 'dean:weekly-summary {--dry-run : List who would get the email without queueing anything}';

    protected $description = 'Queue the Monday weekly OJT summary email for every active Dean who has it turned on';

    public function handle(): int
    {
        $sent = 0;
        foreach (DeanWeeklySummaryService::recipients() as $dean) {
            if ($this->option('dry-run')) {
                $this->line("Would send to dean #{$dean->id} (school #{$dean->school_id})");
                $sent++;

                continue;
            }
            try {
                Mail::to($dean->email)->queue(new DeanWeeklySummary(DeanWeeklySummaryService::build($dean)));
                $sent++;
            } catch (\Throwable $e) {
                // One school's problem must never stop the others.
                report($e);
                $this->error("Skipped dean #{$dean->id}: {$e->getMessage()}");
            }
        }
        $this->info(($this->option('dry-run') ? 'Would queue ' : 'Queued ') . "{$sent} weekly summary email(s).");

        return self::SUCCESS;
    }
}
