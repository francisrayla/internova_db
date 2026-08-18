<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            // Distinguishes real cross-actor events (a coordinator paid, an inquiry
            // came in) from self-signal rows created purely to wake up live-refresh
            // listeners on other open tabs (e.g. a Super Admin's own pause/restore
            // action echoed back to themselves) — only the former belongs in the
            // bell dropdown and notification history.
            $table->boolean('important')->default(true)->after('read_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->dropColumn('important');
        });
    }
};
