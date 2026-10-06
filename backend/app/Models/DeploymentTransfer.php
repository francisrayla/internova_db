<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DeploymentTransfer extends Model
{
    protected $fillable = [
        'deployment_id', 'from_company_id', 'from_supervisor_id', 'to_company_id', 'to_supervisor_id',
        'transferred_on', 'approved_hours_at_transfer', 'transferred_by', 'note',
    ];

    protected $casts = [
        'transferred_on' => 'date',
        'approved_hours_at_transfer' => 'float',
    ];

    public function deployment()
    {
        return $this->belongsTo(InternshipDeployment::class, 'deployment_id');
    }

    public function fromCompany()
    {
        return $this->belongsTo(Company::class, 'from_company_id');
    }

    public function toCompany()
    {
        return $this->belongsTo(Company::class, 'to_company_id');
    }

    public function fromSupervisor()
    {
        return $this->belongsTo(User::class, 'from_supervisor_id');
    }

    public function toSupervisor()
    {
        return $this->belongsTo(User::class, 'to_supervisor_id');
    }
}
