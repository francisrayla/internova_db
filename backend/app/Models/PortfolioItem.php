<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PortfolioItem extends Model
{
    protected $fillable = ['portfolio_id', 'title', 'description', 'image_path', 'project_url'];

    public function portfolio()
    {
        return $this->belongsTo(Portfolio::class);
    }
}
