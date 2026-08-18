<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Portfolio extends Model
{
    protected $fillable = ['intern_id', 'school_id', 'title', 'bio', 'is_public'];

    protected $casts = [
        'is_public' => 'boolean',
    ];

    public function intern()
    {
        return $this->belongsTo(User::class, 'intern_id');
    }

    public function items()
    {
        return $this->hasMany(PortfolioItem::class)->orderByDesc('id');
    }
}
