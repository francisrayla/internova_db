<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            // When a clock-in/out was captured while the device had no
            // connection, `clock_in`/`clock_out` holds the DEVICE's
            // reported time (not the server's) so the record reflects when
            // it actually happened rather than when it finally reached the
            // server — see AttendanceOfflineQueue on the frontend. These
            // flags/timestamps exist so supervisors/coordinators can see
            // which entries that applies to, since those times aren't
            // server-verified the way every other entry's is.
            $table->boolean('clock_in_is_offline')->default(false)->after('clock_in_longitude');
            $table->dateTime('clock_in_synced_at')->nullable()->after('clock_in_is_offline');
            $table->boolean('clock_out_is_offline')->default(false)->after('clock_out_longitude');
            $table->dateTime('clock_out_synced_at')->nullable()->after('clock_out_is_offline');
        });
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropColumn(['clock_in_is_offline', 'clock_in_synced_at', 'clock_out_is_offline', 'clock_out_synced_at']);
        });
    }
};
