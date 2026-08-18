<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The daily narrative entry is where an intern's "what I did today, with a
 * photo" belongs (not Documents, which stays strictly compliance paperwork)
 * — see MyProfile/DailyActivities design discussion. One optional photo per
 * entry, same as a quick proof-of-work snapshot.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('daily_activities', function (Blueprint $table) {
            $table->string('photo_path')->nullable()->after('hours_rendered');
        });
    }

    public function down(): void
    {
        Schema::table('daily_activities', function (Blueprint $table) {
            $table->dropColumn('photo_path');
        });
    }
};
