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
}
