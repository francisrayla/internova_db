<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-user, per-conversation preferences (mute, bubble color) — one row per
 * (viewer, conversation) pair, never shared between participants, same as
 * how Messenger's mute/color choices are private to whoever set them.
 * peer_id is either the other user's id (peer_type=dm) or a
 * group_conversations.id (peer_type=group); it's polymorphic-by-convention
 * rather than a real foreign key since it points at two different tables.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('message_thread_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->enum('peer_type', ['dm', 'group']);
            $table->unsignedBigInteger('peer_id');
            $table->boolean('muted')->default(false);
            $table->string('color', 20)->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'peer_type', 'peer_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_thread_settings');
    }
};
