<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // An unsent message stays as a placeholder row (text and attachment cleared); this marks when.
        Schema::table('messages', function (Blueprint $table) {
            $table->timestamp('unsent_at')->nullable()->after('read_at');
        });
        Schema::table('group_messages', function (Blueprint $table) {
            $table->timestamp('unsent_at')->nullable()->after('is_system');
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropColumn('unsent_at');
        });
        Schema::table('group_messages', function (Blueprint $table) {
            $table->dropColumn('unsent_at');
        });
    }
};
