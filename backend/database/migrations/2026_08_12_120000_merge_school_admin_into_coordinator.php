<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;

return new class extends Migration
{
    /**
     * The Coordinator now doubles as the school's primary contact (registers the school,
     * accepts the subscription offer, pays, manages billing) — the separate school_admin
     * role is retired and folded into coordinator, distinguished by is_primary_coordinator.
     */
    public function up(): void
    {
        Schema::table('coordinator_profiles', function (Blueprint $table) {
            if (!Schema::hasColumn('coordinator_profiles', 'is_primary_coordinator')) {
                $table->boolean('is_primary_coordinator')->default(false)->after('position');
            }
        });

        $schoolAdminRoleId = DB::table('roles')->where('name', 'school_admin')->value('id');
        $coordinatorRoleId = DB::table('roles')->where('name', 'coordinator')->value('id');

        if ($schoolAdminRoleId && $coordinatorRoleId) {
            $users = DB::table('users')->where('role_id', $schoolAdminRoleId)->get();

            foreach ($users as $user) {
                DB::table('users')->where('id', $user->id)->update(['role_id' => $coordinatorRoleId]);

                if ($user->school_id) {
                    $exists = DB::table('coordinator_profiles')
                        ->where('user_id', $user->id)
                        ->exists();

                    if (!$exists) {
                        DB::table('coordinator_profiles')->insert([
                            'user_id'                 => $user->id,
                            'school_id'               => $user->school_id,
                            'position'                => 'Primary Coordinator',
                            'is_primary_coordinator'  => true,
                            'created_at'              => now(),
                            'updated_at'              => now(),
                        ]);
                    } else {
                        DB::table('coordinator_profiles')
                            ->where('user_id', $user->id)
                            ->update(['is_primary_coordinator' => true]);
                    }
                }
            }

            DB::table('roles')->where('id', $schoolAdminRoleId)->delete();
        }
    }

    public function down(): void
    {
        Schema::table('coordinator_profiles', function (Blueprint $table) {
            if (Schema::hasColumn('coordinator_profiles', 'is_primary_coordinator')) {
                $table->dropColumn('is_primary_coordinator');
            }
        });
    }
};
