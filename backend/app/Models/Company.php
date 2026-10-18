<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Company extends Model
{
    protected $fillable = ['school_id', 'company_code', 'company_name', 'address', 'contact_email', 'contact_number', 'latitude', 'longitude', 'allowed_radius_meters', 'location_set_by', 'location_set_at', 'attendance_mode', 'status'];

    // The radius a pin gets when its supervisor does not choose one (metres), and the allowed range.
    public const DEFAULT_RADIUS_M = 200;
    public const MIN_RADIUS_M = 50;
    public const MAX_RADIUS_M = 1000;

    protected $casts = [
        'latitude' => 'float',
        'longitude' => 'float',
        'location_set_at' => 'datetime',
    ];

    /** True when the company's supervisors have put its pin on the map. */
    public function hasLocation(): bool
    {
        return $this->latitude !== null && $this->longitude !== null;
    }

    public function locationSetter()
    {
        return $this->belongsTo(User::class, 'location_set_by');
    }

    /**
     * The map pin as every screen shows it. Only a supervisor of the company can change it; the coordinator and
     * the Dean see it read-only. `set_by`/`set_at` are null for a pin that was seeded rather than set by a person.
     */
    public function locationPayload(): array
    {
        $set = $this->hasLocation();

        return [
            'location_set' => $set,
            'latitude' => $set ? $this->latitude : null,
            'longitude' => $set ? $this->longitude : null,
            'allowed_radius_meters' => $set ? ($this->allowed_radius_meters ?: self::DEFAULT_RADIUS_M) : null,
            'location_set_by' => $set ? $this->locationSetter?->name : null,
            'location_set_at' => $set ? $this->location_set_at?->toIso8601String() : null,
            'location_set_date' => $set ? $this->location_set_at?->local()?->format('M d, Y') : null,
            'location_set_at_label' => $set ? $this->location_set_at?->local()?->format('M d, Y h:i A') : null,
        ];
    }

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
