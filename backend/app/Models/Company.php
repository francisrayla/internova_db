<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Company extends Model
{
    protected $fillable = ['school_id', 'company_code', 'company_name', 'address', 'contact_email', 'contact_number', 'latitude', 'longitude', 'allowed_radius_meters', 'status'];

    public function deployments()
    {
        return $this->hasMany(InternshipDeployment::class);
    }

    public function supervisorProfiles()
    {
        return $this->hasMany(SupervisorProfile::class);
    }

    /**
     * Supervisors whose account is active. Every one of them is responsible
     * for every intern deployed here (no per-intern assignment any more).
     * Eager-load with `company.activeSupervisorProfiles.user`.
     */
    public function activeSupervisorProfiles()
    {
        return $this->hasMany(SupervisorProfile::class)
            ->whereHas('user', fn ($q) => $q->where('status', 'active'));
    }
}
