<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// A company's map pin (latitude, longitude, allowed_radius_meters) is set only by the company's supervisors.
// These two columns record who set it last and when, so the coordinator can see it read-only.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $table) {
            $table->foreignId('location_set_by')->nullable()->after('allowed_radius_meters')->constrained('users')->nullOnDelete();
            $table->timestamp('location_set_at')->nullable()->after('location_set_by');
        });
    }

    public function down(): void
    {
        Schema::table('companies', function (Blueprint $table) {
            $table->dropConstrainedForeignId('location_set_by');
            $table->dropColumn('location_set_at');
        });
    }
};
