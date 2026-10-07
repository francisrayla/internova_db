<?php

namespace App\Jobs;

use App\Models\InternshipDeployment;
use App\Services\NotificationService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Tells every active intern of a company that its attendance format changed.
 * Queued because each notification is also broadcast live, and the supervisor
 * who saved the setting should not wait for all of them.
 */
class NotifyInternsAttendanceFormatChanged implements ShouldQueue
{
    use Queueable;

    public function __construct(private readonly int $companyId, private readonly string $text)
    {
    }

    public function handle(): void
    {
        InternshipDeployment::where('company_id', $this->companyId)->where('status', 'active')->get()->each(
            fn (InternshipDeployment $d) => NotificationService::toUser('intern', $d->intern_id, $d->school_id, 'attendance_settings', 'Attendance format changed', $this->text, '/intern/attendance')
        );
    }
}
