<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GroupMessage extends Model
{
    protected $fillable = ['group_conversation_id', 'sender_id', 'message', 'is_system'];

    public function conversation()
    {
        return $this->belongsTo(GroupConversation::class, 'group_conversation_id');
    }

    public function sender()
    {
        return $this->belongsTo(User::class, 'sender_id');
    }
}
