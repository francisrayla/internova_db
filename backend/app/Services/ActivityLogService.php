<?php

namespace App\Services;

use App\Models\ActivityLog;
use Illuminate\Http\Request;

class ActivityLogService
{
    /**
     * Records one row in the audit trail shown on the Super Admin Activity
     * Logs screen. Call this alongside NotificationService at the same
     * action points — a notification tells one audience "something changed
     * that concerns you," this keeps the permanent record of what happened.
     */
    public static function record(
        string $module,
        string $action,
        ?string $description = null,
        ?int $schoolId = null,
        ?int $userId = null,
        ?Request $request = null
    ): ActivityLog {
        return ActivityLog::create([
            'school_id'   => $schoolId,
            'user_id'     => $userId ?? $request?->user()?->id,
            'action'      => $action,
            'module'      => $module,
            'description' => $description,
            'ip_address'  => $request?->ip(),
        ]);
    }
}
