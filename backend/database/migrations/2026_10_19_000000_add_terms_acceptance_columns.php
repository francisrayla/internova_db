<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Records when (and which version of) the Terms and Conditions + Privacy
 * Notice an account agreed to. Nullable: accounts created before this
 * migration have no acceptance on record and are not blocked.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['users', 'plan_inquiries'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->timestamp('terms_accepted_at')->nullable();
                $t->string('terms_version', 20)->nullable();
            });
        }
    }

    public function down(): void
    {
        foreach (['users', 'plan_inquiries'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->dropColumn(['terms_accepted_at', 'terms_version']);
            });
        }
    }
};
