<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One course a school offers (full canonical name). required_hours NULL = the catalog default. */
class SchoolCourse extends Model
{
    protected $fillable = ['school_id', 'name', 'required_hours', 'sort_order'];

    protected $casts = ['required_hours' => 'integer', 'sort_order' => 'integer'];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }
}
