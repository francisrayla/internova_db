<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('settings', function (Blueprint $table) {
            $table->id();
            $table->string('key')->unique();
            $table->text('value')->nullable();
            $table->string('type')->default('text'); // text | toggle
            $table->string('name');
            $table->text('description')->nullable();
            $table->timestamps();
        });

        // Only settings with a real effect somewhere in the app — see
        // SuperadminFullController::updateSystemSetting() for what each does.
        DB::table('settings')->insert([
            [
                'key' => 'system_name', 'type' => 'text', 'value' => 'Internova AI',
                'name' => 'System Name', 'description' => 'Platform name shown to users.',
                'created_at' => now(), 'updated_at' => now(),
            ],
            [
                'key' => 'support_email', 'type' => 'text', 'value' => 'support@internova.ai',
                'name' => 'Support Email', 'description' => 'Contact address shown to schools that need help.',
                'created_at' => now(), 'updated_at' => now(),
            ],
            [
                'key' => 'maintenance_mode', 'type' => 'toggle', 'value' => '0',
                'name' => 'Maintenance Mode', 'description' => 'Takes the entire platform offline for every user except this session while you make changes.',
                'created_at' => now(), 'updated_at' => now(),
            ],
        ]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('settings');
    }
};
