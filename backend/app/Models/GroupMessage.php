<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

class GroupMessage extends Model
{
    protected $fillable = [
        'group_conversation_id', 'sender_id', 'reply_to_id', 'message', 'is_system', 'unsent_at',
        'attachment_path', 'attachment_name', 'attachment_type', 'attachment_size',
    ];

    protected $casts = [
        'unsent_at' => 'datetime',
    ];

    protected $appends = ['attachment_url'];

    public function conversation()
    {
        return $this->belongsTo(GroupConversation::class, 'group_conversation_id');
    }

    public function sender()
    {
        return $this->belongsTo(User::class, 'sender_id');
    }

    public function replyTo()
    {
        return $this->belongsTo(GroupMessage::class, 'reply_to_id');
    }

    public function getAttachmentUrlAttribute(): ?string
    {
        return $this->attachment_path ? Storage::disk('public')->url($this->attachment_path) : null;
    }
}
