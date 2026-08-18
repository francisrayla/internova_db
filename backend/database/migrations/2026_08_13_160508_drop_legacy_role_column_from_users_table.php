<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drops the pre-RBAC `role` text column. It predates the real `roles` table
 * + `role_id` foreign key (added the next day) that every real permission
 * check in the app actually uses — nothing ever wrote a real value into this
 * column, so every row just sat at its schema default ('Intern') forever,
 * regardless of the user's real role. Dead, misleading, and safe to remove.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('role');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('role')->default('Intern')->after('email');
        });
    }
};
