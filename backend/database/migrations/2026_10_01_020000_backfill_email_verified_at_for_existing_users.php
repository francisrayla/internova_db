<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Login now refuses accounts whose email_verified_at is null (see
     * AuthController::login()), which is meant for new self-registrations
     * only. Accounts that already existed before that gate — seeded ones,
     * the manually-created Super Admin, anyone who registered before it
     * shipped — never had the column set, so they'd suddenly be locked out.
     * Grandfather them in. Accounts with no password yet (invited, not yet
     * accepted) are left alone: accepting the invite verifies them anyway,
     * and so are self-registrations still waiting on their emailed code.
     */
    public function up(): void
    {
        $pendingCodes = DB::table('email_verification_tokens')->pluck('email');

        DB::table('users')
            ->whereNull('email_verified_at')
            ->whereNotNull('password')
            ->whereNotIn('email', $pendingCodes)
            ->update(['email_verified_at' => now()]);
    }

    public function down(): void
    {
        // Not reversible — there's no record of which rows were backfilled.
    }
};
