<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Set when the mail provider reports that an email to this address bounced
 * (the inbox doesn't exist, is full, or rejected it) — lets a coordinator see
 * that an intern's invitation never arrived and fix the address.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('email_bounced_at')->nullable()->after('email_verified_at');
            $table->string('email_bounce_reason', 255)->nullable()->after('email_bounced_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['email_bounced_at', 'email_bounce_reason']);
        });
    }
};
