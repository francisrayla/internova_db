<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CoordinatorProfile;
use App\Models\DeanProfile;
use App\Models\InternshipDeployment;
use App\Models\School;
use App\Models\User;
use App\Rules\CompleteEmail;
use App\Services\AccountInvitationService;
use App\Services\ActivityLogService;
use App\Services\EmailDeliverability;
use App\Services\SchoolStaff;
use App\Support\HeadTitle;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * The school's Dean / Principal: owns the school's account. Billing lives in
 * DeanSubscriptionController; this covers the school's single coordinator
 * (invite, resend, correct a pending email, deactivate), school settings, and
 * the dashboard summary. Always scoped to the authenticated dean's school_id.
 */
class DeanController extends Controller
{
    private function schoolOf(Request $request): ?School
    {
        return School::find($request->user()->school_id);
    }

    private function coordinatorPayload(?User $user): ?array
    {
        if (!$user) {
            return null;
        }

        return [
            'id'          => $user->id,
            'name'        => trim("{$user->first_name} {$user->last_name}") ?: $user->name,
            'email'       => $user->email,
            // pending (invite not accepted yet) | active | inactive
            'status'      => SchoolStaff::accountState($user),
            'invitation_expired' => $user->status === 'pending_activation'
                && $user->invitation_expires_at !== null
                && Carbon::parse($user->invitation_expires_at)->isPast(),
            'email_bounced' => $user->email_bounced_at !== null,
        ];
    }

    /**
     * The coordinator to show: the one holding the school's seat, otherwise
     * the most recent deactivated one (so the page can say "inactive").
     */
    private function currentCoordinator(int $schoolId): ?User
    {
        $roleId = SchoolStaff::roleId('coordinator');

        return SchoolStaff::coordinator($schoolId)
            ?? User::where('school_id', $schoolId)->where('role_id', $roleId)->latest('id')->first();
    }

    // ---------------------------------------------------------------
    // Dashboard
    // ---------------------------------------------------------------

    public function dashboard(Request $request): JsonResponse
    {
        $school = $this->schoolOf($request);
        if (!$school) {
            return response()->json(['success' => false, 'message' => 'School not found.'], 404);
        }

        $subscription = $school->currentSubscription();
        $countByRole = fn (string $role) => User::where('school_id', $school->id)
            ->where('role_id', SchoolStaff::roleId($role))
            ->where('status', '!=', 'inactive')
            ->count();

        return response()->json([
            'success' => true,
            'school'  => ['name' => $school->school_name, 'status' => $school->status, 'is_suspended' => (bool) $school->is_suspended],
            'subscription' => [
                'status'         => $subscription?->effectiveStatus(),
                'plan'           => $subscription?->plan?->name,
                'billing_period' => $subscription?->billing_period,
                'end_date'       => $subscription?->end_date?->format('F d, Y'),
            ],
            'coordinator' => $this->coordinatorPayload($this->currentCoordinator($school->id)),
            'counts' => [
                'supervisors'        => $countByRole('supervisor'),
                'interns'            => $countByRole('intern'),
                'active_deployments' => InternshipDeployment::where('school_id', $school->id)->where('status', 'active')->count(),
            ],
        ]);
    }

    // ---------------------------------------------------------------
    // The school's coordinator (exactly one active-or-pending at a time)
    // ---------------------------------------------------------------

    public function coordinator(Request $request): JsonResponse
    {
        return response()->json([
            'success'     => true,
            'coordinator' => $this->coordinatorPayload($this->currentCoordinator($request->user()->school_id)),
        ]);
    }

    public function inviteCoordinator(Request $request): JsonResponse
    {
        $dean = $request->user();
        $school = $this->schoolOf($request);
        if (!$school) {
            return response()->json(['success' => false, 'message' => 'School not found.'], 404);
        }

        $request->merge(['email' => CompleteEmail::normalize($request->input('email'))]);
        $data = $request->validate([
            'name'  => 'required|string|max:150',
            // Shape only here; the typo / no-mail-server check runs below, after the "already used" check.
            'email' => ['required', 'bail', new CompleteEmail(false)],
        ]);

        if (SchoolStaff::coordinator($school->id)) {
            return response()->json(['success' => false, 'message' => 'Your school already has a coordinator. Deactivate them before inviting a replacement.'], 422);
        }

        // A deactivated coordinator of this school can be re-invited at the same
        // address — the email is unique, so reuse their account instead of failing.
        $existing = User::where('email', $data['email'])->first();
        $reusable = $existing
            && (int) $existing->school_id === (int) $school->id
            && (int) $existing->role_id === (int) SchoolStaff::roleId('coordinator')
            && $existing->status === 'inactive';
        if ($existing && !$reusable) {
            return response()->json(['success' => false, 'message' => 'That email address is already used by another account.', 'errors' => ['email' => ['That email address is already used by another account.']]], 422);
        }

        if ($problem = EmailDeliverability::problem($data['email'])) {
            return response()->json(['success' => false, 'message' => $problem], 422);
        }

        $coordinatorRoleId = SchoolStaff::roleId('coordinator');
        if (!$coordinatorRoleId) {
            return response()->json(['success' => false, 'message' => 'coordinator role is not configured.'], 500);
        }

        [$firstName, $lastName] = array_pad(explode(' ', trim($data['name']), 2), 2, '');
        $fields = [
            'name'       => trim($data['name']),
            'first_name' => $firstName,
            'last_name'  => $lastName,
            'password'   => null,
            'status'     => 'pending_activation',
            'email_bounced_at' => null,
            'email_bounce_reason' => null,
        ];

        $coordinator = DB::transaction(function () use ($reusable, $existing, $fields, $data, $coordinatorRoleId, $school) {
            if ($reusable) {
                $existing->update($fields);
                $user = $existing;
            } else {
                $user = User::create([...$fields, 'email' => $data['email'], 'role_id' => $coordinatorRoleId, 'school_id' => $school->id]);
            }

            // The school's single coordinator — the one other code (e.g. the
            // narrative template) treats as "the" coordinator.
            CoordinatorProfile::updateOrCreate(
                ['user_id' => $user->id],
                ['school_id' => $school->id, 'position' => 'Coordinator', 'is_primary_coordinator' => true]
            );

            return $user;
        });

        $this->sendInvitation($coordinator, $school, $dean);

        ActivityLogService::record(
            module: 'Coordinator',
            action: 'Invited coordinator',
            description: "{$dean->name} invited {$coordinator->name} as the coordinator of {$school->school_name}.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => "Invitation sent to {$coordinator->email}.", 'coordinator' => $this->coordinatorPayload($coordinator)], 201);
    }

    private function sendInvitation(User $coordinator, School $school, User $dean): void
    {
        AccountInvitationService::send(
            $coordinator,
            'Coordinator',
            "of {$school->school_name}",
            trim("{$dean->first_name} {$dean->last_name}") ?: $dean->name,
            $dean->email
        );
    }

    /** The coordinator awaiting activation, or an error response if there isn't one. */
    private function pendingCoordinator(Request $request): User|JsonResponse
    {
        $coordinator = SchoolStaff::coordinator($request->user()->school_id);

        if (!$coordinator) {
            return response()->json(['success' => false, 'message' => 'Your school has no coordinator.'], 404);
        }
        if ($coordinator->status !== 'pending_activation') {
            return response()->json(['success' => false, 'message' => 'The coordinator has already activated their account.'], 422);
        }

        return $coordinator;
    }

    public function resendCoordinatorInvitation(Request $request): JsonResponse
    {
        $coordinator = $this->pendingCoordinator($request);
        if ($coordinator instanceof JsonResponse) {
            return $coordinator;
        }

        $this->sendInvitation($coordinator, $this->schoolOf($request), $request->user());

        ActivityLogService::record(
            module: 'Coordinator',
            action: 'Resent coordinator invitation',
            description: "The coordinator invitation for {$coordinator->name} was resent.",
            schoolId: $coordinator->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Invitation resent.']);
    }

    public function updateCoordinatorEmail(Request $request): JsonResponse
    {
        $coordinator = $this->pendingCoordinator($request);
        if ($coordinator instanceof JsonResponse) {
            return $coordinator;
        }

        $request->merge(['email' => CompleteEmail::normalize($request->input('email'))]);
        $data = $request->validate([
            'email' => ['required', 'bail', new CompleteEmail, Rule::unique('users', 'email')->ignore($coordinator->id)],
        ]);

        $old = $coordinator->email;
        $coordinator->update(['email' => $data['email'], 'email_bounced_at' => null, 'email_bounce_reason' => null]);

        $this->sendInvitation($coordinator, $this->schoolOf($request), $request->user());

        ActivityLogService::record(
            module: 'Coordinator',
            action: 'Corrected coordinator email',
            description: "{$coordinator->name}'s email changed from {$old} to {$data['email']} and the invitation was resent.",
            schoolId: $coordinator->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Email updated and invitation resent.', 'coordinator' => $this->coordinatorPayload($coordinator->fresh())]);
    }

    /**
     * Frees the school's single coordinator seat: the account is kept (history
     * stays intact) but can no longer log in, and any pending invite link dies.
     */
    public function deactivateCoordinator(Request $request): JsonResponse
    {
        $coordinator = SchoolStaff::coordinator($request->user()->school_id);

        if (!$coordinator) {
            return response()->json(['success' => false, 'message' => 'Your school has no active coordinator.'], 404);
        }

        $coordinator->update(['status' => 'inactive', 'invitation_token' => null, 'invitation_expires_at' => null]);
        $coordinator->tokens()->delete();

        ActivityLogService::record(
            module: 'Coordinator',
            action: 'Deactivated coordinator',
            description: "{$request->user()->name} deactivated coordinator {$coordinator->name}.",
            schoolId: $coordinator->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Coordinator deactivated. You can now invite a replacement.']);
    }

    // ---------------------------------------------------------------
    // School settings — the Dean edits, the coordinator only reads
    // (CoordinatorMonitoringController::schoolSettings).
    // ---------------------------------------------------------------

    private function settingsPayload(School $school): array
    {
        return $school->only(['school_name', 'address', 'contact_email', 'contact_number', 'status']);
    }

    public function schoolSettings(Request $request): JsonResponse
    {
        $school = $this->schoolOf($request);
        if (!$school) {
            return response()->json(['success' => false, 'message' => 'School not found.'], 404);
        }

        return response()->json(['success' => true, 'school' => $this->settingsPayload($school)]);
    }

    public function updateSchoolSettings(Request $request): JsonResponse
    {
        $school = $this->schoolOf($request);
        if (!$school) {
            return response()->json(['success' => false, 'message' => 'School not found.'], 404);
        }

        // A mistyped domain ("gmial.com") is refused with a "Did you mean ...?"; an address saved earlier stays accepted as-is.
        $request->merge(['contact_email' => CompleteEmail::normalize($request->input('contact_email'))]);
        $emailChanged = $request->input('contact_email') !== strtolower((string) $school->contact_email);

        $data = $request->validate([
            'school_name'    => ['required', 'string', 'max:255', 'regex:' . \App\Support\TextRules::ORG_NAME],
            'address'        => 'required|string|max:500',
            'contact_email'  => $emailChanged ? ['required', 'bail', 'max:255', new CompleteEmail] : 'required|email|max:255',
            'contact_number' => ['required', 'string', 'regex:/^[0-9]{11}$/'],
        ], ['school_name.regex' => 'School name: ' . \App\Support\TextRules::ORG_NAME_MESSAGE]);

        $school->update($data);

        ActivityLogService::record(
            module: 'Schools',
            action: 'Updated school settings',
            description: "{$request->user()->name} updated {$school->school_name}'s settings.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'School settings updated.', 'school' => $this->settingsPayload($school->fresh())]);
    }

    // ---------------------------------------------------------------
    // Email preferences
    // ---------------------------------------------------------------

    public function preferences(Request $request): JsonResponse
    {
        $profile = DeanProfile::firstOrCreate(['user_id' => $request->user()->id], ['school_id' => $request->user()->school_id]);

        return response()->json(['success' => true, 'weekly_summary_email' => (bool) $profile->fresh()->weekly_summary_email, 'head_title' => HeadTitle::forDean($request->user())]);
    }

    /** The title shown for the school's head everywhere (Dean, Principal or School Head). */
    public function updateHeadTitle(Request $request): JsonResponse
    {
        $data = $request->validate(['head_title' => ['required', 'string', Rule::in(HeadTitle::OPTIONS)]]);
        $profile = DeanProfile::firstOrCreate(['user_id' => $request->user()->id], ['school_id' => $request->user()->school_id]);
        $profile->update(['position' => $data['head_title']]);

        return response()->json(['success' => true, 'head_title' => $data['head_title']]);
    }

    public function updatePreferences(Request $request): JsonResponse
    {
        $data = $request->validate(['weekly_summary_email' => 'required|boolean']);
        $profile = DeanProfile::firstOrCreate(['user_id' => $request->user()->id], ['school_id' => $request->user()->school_id]);
        $profile->update(['weekly_summary_email' => $data['weekly_summary_email']]);

        return response()->json(['success' => true, 'weekly_summary_email' => (bool) $profile->weekly_summary_email]);
    }
}
