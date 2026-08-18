<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GroupConversationMember extends Model
{
    protected $fillable = ['group_conversation_id', 'user_id', 'last_read_at'];

    protected $casts = [
        'last_read_at' => 'datetime',
    ];

    public function conversation()
    {
        return $this->belongsTo(GroupConversation::class, 'group_conversation_id');
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
