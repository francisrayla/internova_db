<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Attendance extends Model
{
    protected $fillable = [
        'deployment_id',
        'attendance_date',
        'session',
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
        'edited_by',
        'edited_at',
        'status',
    ];

    public const WORKDAY_HOURS = 8;

    // full = one time in/out for the whole day; am/pm = the two halves of a split day.
    public const FULL = 'full';
    public const AM = 'am';
    public const PM = 'pm';

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
        'edited_at' => 'datetime',
    ];

    /**
     * Closes any record still open WORKDAY_HOURS after its clock-in, stamping
     * the time-out at exactly clock_in + WORKDAY_HOURS (no selfie/location —
     * flagged so supervisors and coordinators can tell it apart).
     */
    public static function autoCloseStale(): void
    {
        // A half day is closed sooner than a whole one.
        static::with('deployment.intern')->whereNotNull('clock_in')
            ->whereNull('clock_out')
            ->where('clock_in', '<=', now()->subHours(self::WORKDAY_HOURS / 2))
            ->get()
            ->each(function (self $a) {
                $hours = $a->session === self::FULL ? self::WORKDAY_HOURS : self::WORKDAY_HOURS / 2;
                if ($a->clock_in->gt(now()->subHours($hours))) {
                    return;
                }
                $a->update([
                    'clock_out' => $a->clock_in->copy()->addHours($hours),
                    'auto_clocked_out' => true,
                ]);
                // A morning that was never closed is not the end of the day.
                if ($a->session !== self::AM) {
                    \App\Jobs\GenerateNarrativeForAttendance::dispatch($a->id);
                }
                // The only attendance news a supervisor gets: an intern forgot to time out.
                // This runs inside ordinary requests, so a failed notification must never break one.
                rescue(fn () => $a->notifyAutoClosed());
            });
    }

    /** Longest a single shift may last: a whole day, or half of one for a morning / afternoon. */
    public static function maxHoursFor(?string $session): float
    {
        return $session === self::AM || $session === self::PM ? self::WORKDAY_HOURS / 2 : self::WORKDAY_HOURS;
    }

    /** Tells every supervisor of the company that this shift was closed by the system. */
    public function notifyAutoClosed(): void
    {
        $deployment = $this->deployment;
        if (!$deployment) {
            return;
        }
        $intern = $deployment->intern;
        $name = trim("{$intern?->first_name} {$intern?->last_name}") ?: (string) $intern?->name;
        $part = match ($this->session) {
            self::AM => ' (morning)',
            self::PM => ' (afternoon)',
            default => '',
        };
        $deployment->notifySupervisors(
            'attendance_auto_closed',
            'Intern forgot to time out',
            "{$name} did not time out on {$this->attendance_date?->format('M d, Y')}{$part}. The system closed it at {$this->clock_out?->local()?->format('h:i A')}. If they left earlier, correct the time on the Attendance page.",
            '/supervisor/attendance'
        );
    }

    /** Minutes between this row's time in and time out (0 while still open). */
    public function workedMinutes(): int
    {
        return ($this->clock_in && $this->clock_out) ? max(0, $this->clock_in->diffInMinutes($this->clock_out)) : 0;
    }

    public function deployment()
    {
        return $this->belongsTo(InternshipDeployment::class, 'deployment_id');
    }
}
