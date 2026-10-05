<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

class NarrativeTemplate extends Model
{
    protected $fillable = ['school_id', 'logo_path', 'letterhead', 'cover', 'sections'];

    protected $casts = [
        'letterhead' => 'array',
        'cover' => 'array',
        'sections' => 'array',
    ];

    public function school()
    {
        return $this->belongsTo(School::class);
    }

    public function logoUrl(): ?string
    {
        return $this->logo_path ? Storage::disk('public')->url($this->logo_path) : null;
    }
}
