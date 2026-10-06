<?php

namespace App\Models;

use App\Services\NotificationService;
use Illuminate\Database\Eloquent\Model;

class InternshipDeployment extends Model
{
    protected $fillable = ['school_id', 'intern_id', 'company_id', 'supervisor_id', 'coordinator_id', 'start_date', 'end_date', 'required_hours', 'status'];

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
