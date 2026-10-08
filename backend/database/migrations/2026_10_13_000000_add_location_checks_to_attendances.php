<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What the server worked out about WHERE each clock-in/out happened, so a reviewer sees more than a
 * pin: the distance from the company, how precise the phone said its fix was, and any reason the
 * location looks unreliable (outside the allowed area, the exact same coordinates again and again...).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            foreach (['clock_in', 'clock_out'] as $punch) {
                $table->unsignedInteger("{$punch}_distance_m")->nullable();
                $table->unsignedInteger("{$punch}_accuracy_m")->nullable();
                $table->json("{$punch}_location_flags")->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            foreach (['clock_in', 'clock_out'] as $punch) {
                $table->dropColumn(["{$punch}_distance_m", "{$punch}_accuracy_m", "{$punch}_location_flags"]);
            }
        });
    }
};
