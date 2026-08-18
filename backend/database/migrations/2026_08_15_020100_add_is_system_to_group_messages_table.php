<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "X created the group" and similar notices render as a centered system
 * pill instead of a normal chat bubble (see MessengerWidget) — this flag
 * is how the frontend tells the two apart.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('group_messages', function (Blueprint $table) {
            $table->boolean('is_system')->default(false)->after('message');
        });
    }

    public function down(): void
    {
        Schema::table('group_messages', function (Blueprint $table) {
            $table->dropColumn('is_system');
        });
    }
};
