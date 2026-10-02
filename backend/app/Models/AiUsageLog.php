<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AiUsageLog extends Model
{
    public const POLISH = 'narrative_polish';
    public const DRAFT = 'narrative_draft';

    protected $fillable = ['school_id', 'user_id', 'feature', 'model', 'succeeded'];

    protected $casts = [
        'succeeded' => 'boolean',
    ];
}
