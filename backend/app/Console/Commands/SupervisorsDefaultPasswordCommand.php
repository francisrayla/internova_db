<?php

namespace App\Console\Commands;

use App\Models\Company;
use App\Models\SupervisorProfile;
use App\Models\User;
use App\Services\AccountInvitationService;
use App\Services\ActivityLogService;
use App\Services\SchoolStaff;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Supervisors created before the invitation flow were given the fixed
 * password "password" and an already-verified email. Anyone who knows such
 * a supervisor's address can sign in as them.
 *
 * Default (dry run): lists the active supervisors whose password still
 * verifies against the literal "password". Nothing is changed.
 *
 * --invite: for each of them, drops the password, sets the account back to
 * pending_activation, clears the verified-email stamp, ends their sessions
 * and emails the usual single-use "set your own password" link. Safe to
 * re-run: an account that is already pending no longer matches. Only the
 * supervisor role is ever touched; the real Super Admin is excluded on top.
 */
class SupervisorsDefaultPasswordCommand extends Command
{
    private const PROTECTED_EMAILS = ['francisrayla12345@gmail.com'];

    protected $signature = 'supervisors:default-password {--invite : Lock these accounts and email each one a link to set their own password}';

    protected $description = 'List (dry run) or re-invite supervisors who still use the default password "password"';

    public function handle(): int
    {
        $invite = (bool) $this->option('invite');
        $roleId = SchoolStaff::roleId('supervisor');
        if (!$roleId) {
            $this->warn('The supervisor role does not exist. Nothing to do.');

            return self::SUCCESS;
        }

        $matches = User::with('school')
            ->where('role_id', $roleId)
            ->where('status', 'active')
            ->whereNotNull('password')
            ->whereNotIn('email', self::PROTECTED_EMAILS)
            ->orderBy('id')
            ->get()
            ->filter(fn (User $u) => Hash::check('password', $u->password))
            ->values();

        if ($matches->isEmpty()) {
            $this->info('No supervisor is using the default password. Nothing to do.');

            return self::SUCCESS;
        }

        $this->table(
            ['ID', 'Name', 'Email', 'School'],
            $matches->map(fn (User $u) => [$u->id, $u->name, $u->email, $u->school?->school_name ?? '-'])->all()
        );

        if (!$invite) {
            $this->warn("{$matches->count()} supervisor(s) still use the default password. Dry run only; nothing was changed.");
            $this->line('Run with --invite to lock these accounts and email each one a link to set their own password.');

            return self::SUCCESS;
        }

        foreach ($matches as $user) {
            $this->lockAndInvite($user);
        }

        $this->info("{$matches->count()} supervisor(s) locked and invited.");

        return self::SUCCESS;
    }

    private function lockAndInvite(User $user): void
    {
        DB::transaction(function () use ($user) {
            $user->update([
                'password' => null,
                'status' => 'pending_activation',
                'email_verified_at' => null,
            ]);
            // A browser still signed in with the old password is cut off too.
            $user->tokens()->delete();
        });

        $company = Company::find(SupervisorProfile::where('user_id', $user->id)->value('company_id'));
        $inviter = SchoolStaff::coordinator($user->school_id) ?? SchoolStaff::dean($user->school_id);

        AccountInvitationService::send(
            $user,
            'Supervisor',
            $company ? "at {$company->company_name}" : '',
            $inviter ? (trim("{$inviter->first_name} {$inviter->last_name}") ?: $inviter->name) : 'Internova',
            $inviter?->email ?? config('mail.from.address'),
        );

        ActivityLogService::record(
            module: 'Companies',
            action: 'Reset default supervisor password',
            description: "{$user->name} was still using the default password, so their account was locked and a new invitation was sent.",
            schoolId: $user->school_id,
        );

        $this->line("  invited {$user->email}");
    }
}
