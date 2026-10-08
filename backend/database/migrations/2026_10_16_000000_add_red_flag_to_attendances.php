<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Red flags on attendance. `clock_in_odd_hours` is set when an intern clocks in at an unusual hour
 * (see Attendance::isOddHour). `red_flag` is the one column the lists filter and sort on: it is true when the
 * record has an odd-hours clock-in OR a red location flag (location_tampering, impossible_travel), and the
 * model keeps it in step on every save. A supervisor marks a flag as checked (who and when), which stops it
 * being pinned to the top of their list but keeps the red badge.
 *
 * Existing rows are not flagged for odd hours (nobody is told about last month); rows that already carry a
 * red location flag are marked, so the new filter finds them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->boolean('clock_in_odd_hours')->default(false);
            $table->boolean('red_flag')->default(false)->index();
            $table->foreignId('red_flag_checked_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('red_flag_checked_at')->nullable();
        });

        DB::table('attendances')
            ->where(function ($q) {
                foreach (['clock_in_location_flags', 'clock_out_location_flags'] as $column) {
                    $q->orWhere($column, 'like', '%location_tampering%')->orWhere($column, 'like', '%impossible_travel%');
                }
            })
            ->update(['red_flag' => true]);
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropConstrainedForeignId('red_flag_checked_by');
            $table->dropColumn(['clock_in_odd_hours', 'red_flag', 'red_flag_checked_at']);
        });
    }
};
