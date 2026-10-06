<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Document extends Model
{
    protected $fillable = ['deployment_id', 'uploaded_by', 'document_type', 'file_name', 'file_path', 'status', 'remarks', 'reviewed_at'];

    protected $casts = ['reviewed_at' => 'datetime'];

    public function deployment()
    {
        return $this->belongsTo(InternshipDeployment::class, 'deployment_id');
    }

    public function uploadedBy()
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}
