<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Each company chooses how its interns record attendance:
//   single: one time in and one time out a day (the original behaviour)
//   split:  morning time in/out and afternoon time in/out (four a day)
// A split day is stored as two attendance rows (session am and pm), so the
// hours that are already summed row by row stay correct without any rewrite.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $table) {
            $table->string('attendance_mode', 10)->default('single')->after('allowed_radius_meters');
        });

        Schema::table('attendances', function (Blueprint $table) {
            $table->string('session', 10)->default('full')->after('attendance_date');
            $table->index(['deployment_id', 'attendance_date', 'session'], 'attendances_day_session_index');
        });
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropIndex('attendances_day_session_index');
            $table->dropColumn('session');
        });
        Schema::table('companies', function (Blueprint $table) {
            $table->dropColumn('attendance_mode');
        });
    }
};
