<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

class Portfolio extends Model
{
    protected $fillable = ['intern_id', 'school_id', 'title', 'bio', 'report_texts'];

    protected $casts = ['report_texts' => 'array'];

    public function intern()
    {
        return $this->belongsTo(User::class, 'intern_id');
    }

    public function items()
    {
        return $this->hasMany(PortfolioItem::class)->orderByDesc('id');
    }

    /**
     * Shared response shape — the intern's own editor view and the
     * read-only views a supervisor/coordinator get of one of their interns
     * all render from this same mapping, so they never drift apart.
     */
    public function present(): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'bio' => $this->bio,
            'report_texts' => $this->report_texts ?? (object) [],
            'items' => $this->items->map(fn (PortfolioItem $i) => [
                'id' => $i->id,
                'title' => $i->title,
                'description' => $i->description,
                'image_url' => $i->image_path ? Storage::disk('public')->url($i->image_path) : null,
                'project_url' => $i->project_url,
            ]),
        ];
    }
}
