<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drops the `team` column — added alongside the old pre-RBAC `role` column
 * (see the migration that dropped `role`), never populated by any real
 * feature, and never read from the database by any live code path.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('team');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('team')->nullable()->after('status');
        });
    }
};
