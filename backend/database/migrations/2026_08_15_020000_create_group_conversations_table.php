<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Group chats sit deliberately apart from the 1:1 `messages` table (see
 * MessageController) — mixing "one receiver" and "many members" into one
 * schema would have complicated the read/unread logic for both. Only a
 * coordinator or supervisor can create one (see
 * MessageController::createGroup), always drawing members from the same
 * eligibleContacts() list 1:1 messaging already uses, but every member
 * (interns included) can post in it once added.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('group_conversations', function (Blueprint $table) {
            $table->id();
            $table->string('name')->nullable();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
        });

        Schema::create('group_conversation_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('group_conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->dateTime('last_read_at')->nullable();
            $table->timestamps();
            $table->unique(['group_conversation_id', 'user_id']);
        });

        Schema::create('group_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('group_conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sender_id')->constrained('users')->cascadeOnDelete();
            $table->text('message');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('group_messages');
        Schema::dropIfExists('group_conversation_members');
        Schema::dropIfExists('group_conversations');
    }
};
