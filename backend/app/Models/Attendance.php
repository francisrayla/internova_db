<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Attendance extends Model
{
    protected $fillable = [
        'deployment_id',
        'attendance_date',
        'clock_in',
        'clock_in_selfie_path',
        'clock_in_latitude',
        'clock_in_longitude',
        'clock_in_is_offline',
        'clock_in_synced_at',
        'clock_out',
        'clock_out_selfie_path',
        'clock_out_latitude',
        'clock_out_longitude',
        'clock_out_is_offline',
        'clock_out_synced_at',
        'auto_clocked_out',
        'status',
    ];

    public const WORKDAY_HOURS = 8;

    protected $casts = [
        'attendance_date' => 'date',
        'clock_in' => 'datetime',
        'clock_out' => 'datetime',
        'clock_in_latitude' => 'float',
        'clock_in_longitude' => 'float',
        'clock_out_latitude' => 'float',
        'clock_out_longitude' => 'float',
        'clock_in_is_offline' => 'boolean',
        'clock_in_synced_at' => 'datetime',
        'clock_out_is_offline' => 'boolean',
        'clock_out_synced_at' => 'datetime',
        'auto_clocked_out' => 'boolean',
    ];

    /**
     * Closes any record still open WORKDAY_HOURS after its clock-in, stamping
     * the time-out at exactly clock_in + WORKDAY_HOURS (no selfie/location —
     * flagged so supervisors and coordinators can tell it apart).
     */
    public static function autoCloseStale(): void
    {
        static::whereNotNull('clock_in')
            ->whereNull('clock_out')
            ->where('clock_in', '<=', now()->subHours(self::WORKDAY_HOURS))
            ->get()
            ->each(function (self $a) {
                $a->update([
                    'clock_out' => $a->clock_in->copy()->addHours(self::WORKDAY_HOURS),
                    'auto_clocked_out' => true,
                ]);
                \App\Jobs\GenerateNarrativeForAttendance::dispatch($a->id);
            });
    }

    public function deployment()
    {
        return $this->belongsTo(InternshipDeployment::class, 'deployment_id');
    }
}
