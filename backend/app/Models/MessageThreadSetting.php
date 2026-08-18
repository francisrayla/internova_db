<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MessageThreadSetting extends Model
{
    protected $fillable = ['user_id', 'peer_type', 'peer_id', 'muted', 'color'];

    protected $casts = ['muted' => 'boolean'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
