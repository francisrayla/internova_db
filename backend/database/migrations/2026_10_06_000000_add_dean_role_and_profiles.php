<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The Dean (or Principal / School Head) is the school's account owner:
     * accepts the subscription offer, pays, edits school settings and invites
     * the school's single coordinator. Role ids differ between environments,
     * so everything looks the role up by name.
     */
    public function up(): void
    {
        // A brand-new database has no roles yet — InternovaSeeder creates them
        // in a fixed order, and inserting dean first here would shift the ids.
        if (DB::table('roles')->count() > 0 && !DB::table('roles')->where('name', 'dean')->exists()) {
            DB::table('roles')->insert([
                'name'        => 'dean',
                'description' => 'School dean / principal — owns the subscription and billing, edits school settings and invites the school coordinator',
                'created_at'  => now(),
                'updated_at'  => now(),
            ]);
        }

        Schema::create('dean_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->string('position')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dean_profiles');
        DB::table('roles')->where('name', 'dean')->delete();
    }
};
