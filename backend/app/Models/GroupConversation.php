<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GroupConversation extends Model
{
    protected $fillable = ['name', 'created_by', 'school_id'];

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function members()
    {
        return $this->hasMany(GroupConversationMember::class);
    }

    public function messages()
    {
        return $this->hasMany(GroupMessage::class)->orderBy('created_at');
    }
}
