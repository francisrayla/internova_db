<?php

namespace App\Models;

use App\Support\LocalTime;
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
        'clock_in_distance_m',
        'clock_in_accuracy_m',
        'clock_in_location_flags',
        'clock_out',
        'clock_out_selfie_path',
        'clock_out_latitude',
        'clock_out_longitude',
        'clock_out_is_offline',
        'clock_out_synced_at',
        'clock_out_distance_m',
        'clock_out_accuracy_m',
        'clock_out_location_flags',
        'auto_clocked_out',
        'edited_by',
        'edited_at',
        'clock_in_odd_hours',
        'red_flag',
        'red_flag_checked_by',
        'red_flag_checked_at',
        'status',
    ];

    public const WORKDAY_HOURS = 8;

    // A clock-in at or after 5:00 PM, or before 5:00 AM, Philippine time is an odd hour: it is red-flagged and
    // the company's supervisors are told. (Local hour 0-23; the window wraps midnight.)
    public const ODD_HOURS_FROM = 17;
    public const ODD_HOURS_BEFORE = 5;

    // Location flags that count as "red" (the other location flags are only amber/grey hints).
    // outside_area = further from the company's map pin than its radius; it is a warning for the supervisor, never a refusal.
    public const RED_LOCATION_FLAGS = ['location_tampering', 'impossible_travel', 'outside_area'];

    // full = one time in/out for the whole day; am/pm = the two halves of a split day.
    public const FULL = 'full';
    public const AM = 'am';
    public const PM = 'pm';

    protected $casts = [
        'attendance_date' => 'date',
        'clock_in' => 'datetime',
        'clock_out' => 'datetime',
        'clock_in_latitude' => 'float',
        'clock_in_location_flags' => 'array',
        'clock_out_location_flags' => 'array',
        'clock_in_longitude' => 'float',
        'clock_out_latitude' => 'float',
        'clock_out_longitude' => 'float',
        'clock_in_is_offline' => 'boolean',
        'clock_in_synced_at' => 'datetime',
        'clock_out_is_offline' => 'boolean',
        'clock_out_synced_at' => 'datetime',
        'auto_clocked_out' => 'boolean',
        'edited_at' => 'datetime',
        'clock_in_odd_hours' => 'boolean',
        'red_flag' => 'boolean',
        'red_flag_checked_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        // red_flag is the one column the lists filter and sort on, so it is derived here, never set by hand.
        static::saving(function (self $a) {
            $a->red_flag = $a->clock_in_odd_hours || count($a->redLocationFlags()) > 0;
        });
    }

    /** True when this moment (any timezone) falls in the odd-hours window of the display timezone. */
    public static function isOddHour(\DateTimeInterface|string|null $moment): bool
    {
        $local = LocalTime::of($moment);
        if (!$local) {
            return false;
        }

        return $local->hour >= self::ODD_HOURS_FROM || $local->hour < self::ODD_HOURS_BEFORE;
    }

    /** The red location flags on either punch (location_tampering, impossible_travel). */
    public function redLocationFlags(): array
    {
        $all = [...($this->clock_in_location_flags ?? []), ...($this->clock_out_location_flags ?? [])];

        return array_values(array_intersect(array_unique($all), self::RED_LOCATION_FLAGS));
    }

    /** A red flag nobody has looked at yet: the supervisor's list pins these to the top. */
    public function redFlagPending(): bool
    {
        return $this->red_flag && $this->red_flag_checked_at === null;
    }

    /** Shown on the record: "Red flag: clocked in at 6:12 PM" (location reasons are shown by LocationFlags). */
    public function redFlagText(): ?string
    {
        if (!$this->red_flag) {
            return null;
        }
        $reasons = [];
        if ($this->clock_in_odd_hours) {
            $reasons[] = 'clocked in at ' . LocalTime::time($this->clock_in, 'g:i A');
        }
        if ($this->outsideAreaLabel()) {
            $reasons[] = lcfirst($this->outsideAreaLabel());
        }
        if (array_diff($this->redLocationFlags(), ['outside_area'])) {
            $reasons[] = 'suspicious location';
        }

        return 'Red flag: ' . ($reasons ? implode('; ', $reasons) : 'suspicious location');
    }

    /** "Outside the company area (350 m away)" when a punch was further than the company's radius, else null. */
    public function outsideAreaLabel(): ?string
    {
        $far = fn (int $m) => $m >= 1000 ? number_format($m / 1000, 1) . ' km' : "{$m} m";
        $parts = [];
        foreach (['clock_in' => 'time in', 'clock_out' => 'time out'] as $punch => $label) {
            if (in_array('outside_area', $this->{"{$punch}_location_flags"} ?? [], true)) {
                $parts[$label] = $this->{"{$punch}_distance_m"};
            }
        }
        if (!$parts) {
            return null;
        }
        $known = array_filter($parts, fn ($m) => $m !== null);
        if (count($known) === 2 && count($parts) === 2) {
            return 'Outside the company area (' . $far((int) $parts['time in']) . ' away at time in, ' . $far((int) $parts['time out']) . ' at time out)';
        }

        return 'Outside the company area' . ($known ? ' (' . $far((int) max($known)) . ' away)' : '');
    }

    /** Fields every attendance list shares so the badge, the checked state and the pinning read the same everywhere. */
    public function redFlagPayload(): array
    {
        return [
            'red_flag' => (bool) $this->red_flag,
            'red_flag_text' => $this->redFlagText(),
            'outside_area_label' => $this->outsideAreaLabel(),
            'red_flag_checked' => $this->red_flag && $this->red_flag_checked_at !== null,
            'red_flag_checked_at' => $this->red_flag_checked_at?->local()?->format('M d, h:i A'),
            'red_flag_checked_by' => $this->red_flag_checked_at ? $this->redFlagChecker?->name : null,
        ];
    }

    /** flag filter: 'red' = every red-flagged record, 'unchecked' = only those nobody has checked yet. */
    public function scopeFlagged($query, ?string $flag)
    {
        return match ($flag) {
            'red' => $query->where('attendances.red_flag', true),
            'unchecked' => $query->where('attendances.red_flag', true)->whereNull('attendances.red_flag_checked_at'),
            default => $query,
        };
    }

    /** Unchecked red flags first, then the caller's own ordering. */
    public function scopePinUncheckedFlags($query)
    {
        return $query->orderByRaw('CASE WHEN attendances.red_flag = 1 AND attendances.red_flag_checked_at IS NULL THEN 0 ELSE 1 END');
    }

    /** Interns whose name contains the text (first, last or full name). */
    public function scopeInternNameLike($query, ?string $search)
    {
        $search = trim((string) $search);
        if ($search === '') {
            return $query;
        }
        $like = '%' . addcslashes($search, '%_\\') . '%';

        return $query->whereHas('deployment.intern', fn ($q) => $q->where(function ($w) use ($like) {
            $w->where('first_name', 'like', $like)
                ->orWhere('last_name', 'like', $like)
                ->orWhere('name', 'like', $like)
                ->orWhereRaw("CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) like ?", [$like]);
        }));
    }

    public function redFlagChecker()
    {
        return $this->belongsTo(User::class, 'red_flag_checked_by');
    }

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

    /**
     * Tells every active supervisor of the intern's company that a clock-in happened at an odd hour. Supervisors
     * only: they are the ones who grade attendance, so neither the coordinator nor the Dean is pinged.
     */
    public function notifyOddHoursClockIn(): void
    {
        $deployment = $this->deployment;
        if (!$deployment || !$this->clock_in) {
            return;
        }
        $intern = $deployment->intern;
        $name = trim("{$intern?->first_name} {$intern?->last_name}") ?: (string) $intern?->name;
        $time = LocalTime::time($this->clock_in, 'g:i A');
        $how = $this->clock_in_is_offline ? ' The entry was made offline and sent later; the time is when the photo was taken.' : '';
        $deployment->notifySupervisors(
            'attendance_red_flag',
            'Red flag: clock-in at an unusual hour',
            "{$name} clocked in at {$time} on {$this->attendance_date?->format('M d, Y')}, outside the normal hours.{$how} Please check the photo and mark it as checked.",
            '/supervisor/attendance?flag=unchecked'
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
