<?php

namespace App\Models;

use App\Services\NotificationService;
use App\Support\LocalTime;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

class InternshipDeployment extends Model
{
    /** How far from today a start date may be. A start date years away is a typo, not a plan. */
    public const START_DAYS_BACK = 60;
    public const START_DAYS_AHEAD = 90;

    protected $fillable = ['school_id', 'intern_id', 'company_id', 'supervisor_id', 'coordinator_id', 'start_date', 'end_date', 'required_hours', 'status'];

    /** @return array{0:string,1:string} the earliest and latest allowed start date (Y-m-d) */
    public static function startDateBounds(): array
    {
        $today = Carbon::parse(LocalTime::today());

        return [$today->copy()->subDays(self::START_DAYS_BACK)->toDateString(), $today->copy()->addDays(self::START_DAYS_AHEAD)->toDateString()];
    }

    public static function startDateRules(): array
    {
        [$min, $max] = self::startDateBounds();

        return ['required', 'date', "after_or_equal:{$min}", "before_or_equal:{$max}"];
    }

    public static function startDateMessages(): array
    {
        [$min, $max] = self::startDateBounds();
        $fmt = fn (string $d) => Carbon::parse($d)->format('M j, Y');

        return [
            'start_date.after_or_equal' => 'The start date can be at most ' . self::START_DAYS_BACK . " days in the past (not before {$fmt($min)}).",
            'start_date.before_or_equal' => 'The start date can be at most ' . (self::START_DAYS_AHEAD / 30) . " months ahead (not after {$fmt($max)}).",
        ];
    }

    /** True once the internship's first day has come (a day with no start date counts as started). */
    public function hasStartedOn(string|Carbon|null $date = null): bool
    {
        if (!$this->start_date) {
            return true;
        }

        return $this->start_date->copy()->startOfDay()->lte(Carbon::parse($date ?? LocalTime::today())->startOfDay());
    }

    /** Hours of approved, completed attendance, the same measure every progress screen uses. */
    public function approvedHours(): float
    {
        return Attendance::where('deployment_id', $this->id)
            ->where('status', 'approved')
            ->whereNotNull('clock_in')
            ->whereNotNull('clock_out')
            ->get()
            ->sum(fn ($a) => max(0, Carbon::parse($a->clock_in)->diffInMinutes(Carbon::parse($a->clock_out))) / 60);
    }

    /** Finished: marked completed, or the required hours are already rendered. */
    public function isFinished(): bool
    {
        if ($this->status === 'completed') {
            return true;
        }
        $required = (int) $this->required_hours;

        return $required > 0 && $this->approvedHours() >= $required;
    }

    /**
     * Why this intern cannot clock in on the given day, or null when they can.
     * The code is what the app keys its message and buttons on.
     *
     * @return array{code:string,message:string,starts_on:?string}|null
     */
    public function attendanceBlock(string|Carbon|null $date = null): ?array
    {
        if ($this->status === 'inactive') {
            return ['code' => 'inactive', 'starts_on' => null,
                'message' => 'Your internship is marked inactive, so attendance is closed. Please contact your coordinator.'];
        }
        if (!$this->hasStartedOn($date)) {
            return ['code' => 'not_started', 'starts_on' => $this->start_date->toDateString(),
                'message' => "Your internship starts on {$this->start_date->format('F j, Y')}. You can clock in from that day."];
        }
        if ($this->isFinished()) {
            $required = (int) $this->required_hours;

            return ['code' => 'finished', 'starts_on' => null,
                'message' => $this->status === 'completed' || $required <= 0
                    ? 'Your internship is completed, so attendance is now closed.'
                    : "You have completed your {$required} required hours, so attendance is now closed."];
        }

        return null;
    }

    protected $casts = [
        'start_date' => 'date',
        'end_date' => 'date',
    ];

    /**
     * THE access rule for supervisors: a supervisor sees and acts on every
     * deployment at the company on their profile (same school). The legacy
     * deployments.supervisor_id column is no longer consulted.
     */
    public function scopeVisibleToSupervisor($query, User $user)
    {
        $companyId = SupervisorProfile::where('user_id', $user->id)->value('company_id');
        if (!$companyId) {
            return $query->whereRaw('1 = 0');
        }
        $table = $query->getModel()->getTable();

        return $query->where("{$table}.company_id", $companyId)->where("{$table}.school_id", $user->school_id);
    }

    /**
     * Interns who finished setting up their account. An invited intern who never opened the link
     * (status pending_activation) cannot be given tasks yet - nobody could see or do them.
     */
    public function scopeAccountSetUp($query)
    {
        return $query->whereHas('intern', fn ($q) => $q->where('status', '!=', 'pending_activation'));
    }

    /** Active supervisor users of this deployment's company (all of them). */
    public function companySupervisors()
    {
        $this->loadMissing('company.activeSupervisorProfiles.user');

        return ($this->company?->activeSupervisorProfiles ?? collect())->map(fn ($p) => $p->user)->filter()->values();
    }

    /** "Jose Dela Cruz, onyok padilla" or null when the company has none. */
    public function supervisorNames(): ?string
    {
        $names = $this->companySupervisors()
            ->map(fn (User $u) => trim("{$u->first_name} {$u->last_name}") ?: $u->name)
            ->filter()->values();

        return $names->isEmpty() ? null : $names->implode(', ');
    }

    /**
     * Notify every active supervisor of the company (one row each, no
     * duplicates). Replaces notifying the single deployments.supervisor_id.
     */
    public function notifySupervisors(string $type, string $title, ?string $body, ?string $link): void
    {
        foreach ($this->companySupervisors()->pluck('id')->unique() as $userId) {
            NotificationService::toUser('supervisor', $userId, $this->school_id, $type, $title, $body, $link);
        }
    }

    public function transfers()
    {
        return $this->hasMany(DeploymentTransfer::class, 'deployment_id')->orderBy('transferred_on')->orderBy('id');
    }

    public function school()
    {
        return $this->belongsTo(School::class);
    }

    public function intern()
    {
        return $this->belongsTo(User::class, 'intern_id');
    }

    public function company()
    {
        return $this->belongsTo(Company::class);
    }

    public function supervisor()
    {
        return $this->belongsTo(User::class, 'supervisor_id');
    }

    public function coordinator()
    {
        return $this->belongsTo(User::class, 'coordinator_id');
    }
}
