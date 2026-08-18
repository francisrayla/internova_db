<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->string('clock_in_selfie_path')->nullable()->after('clock_in');
            $table->decimal('clock_in_latitude', 10, 7)->nullable()->after('clock_in_selfie_path');
            $table->decimal('clock_in_longitude', 10, 7)->nullable()->after('clock_in_latitude');
            $table->string('clock_out_selfie_path')->nullable()->after('clock_out');
            $table->decimal('clock_out_latitude', 10, 7)->nullable()->after('clock_out_selfie_path');
            $table->decimal('clock_out_longitude', 10, 7)->nullable()->after('clock_out_latitude');
        });
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropColumn([
                'clock_in_selfie_path',
                'clock_in_latitude',
                'clock_in_longitude',
                'clock_out_selfie_path',
                'clock_out_latitude',
                'clock_out_longitude',
            ]);
        });
    }
};
