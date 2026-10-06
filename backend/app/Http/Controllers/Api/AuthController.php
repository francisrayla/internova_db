<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email'    => 'required|email',
            'password' => 'required|string',
        ]);

        $user = User::with(['roles', 'coordinatorProfile', 'deanProfile', 'school.subscriptions.plan'])->where('email', $data['email'])->first();

        if (!$user || !$user->password || !Hash::check($data['password'], $user->password)) {
            return response()->json(['success' => false, 'message' => 'Invalid email or password.'], 401);
        }

        // Self-registered accounts (the public Inquiry form) start with
        // email_verified_at null and stay that way until the code emailed
        // at signup is entered — see EmailVerificationController. Invited
        // accounts (supervisors/interns) are already verified by the time
        // they set a password, since clicking the invite link proves the
        // same thing (see InvitationController::accept()).
        if (!$user->email_verified_at) {
            return response()->json([
                'success'          => false,
                'needsVerification'=> true,
                'message'          => 'Please verify your email before logging in. Check your inbox for the code we sent you.',
            ], 403);
        }

        // A deactivated account (e.g. a coordinator the Dean replaced) keeps its
        // history but can no longer sign in.
        if ($user->status === 'inactive') {
            return response()->json([
                'success' => false,
                'message' => 'This account has been deactivated. Please contact your school.',
            ], 403);
        }

        // The login route can't go through EnforceMaintenanceMode (nothing to
        // check who's signing in until credentials are verified, right
        // above) — so it does the same Super-Admin-only check itself, right
        // here, once it actually knows. A Super Admin can always still log
        // in to turn maintenance back off.
        if (Setting::value('maintenance_mode', '0') === '1' && (int) $user->role_id !== 1) {
            return response()->json([
                'success'     => false,
                'maintenance' => true,
                'message'     => 'Internova is currently undergoing maintenance. Please check back shortly.',
            ], 503);
        }

        // Replace any tokens from previous sessions — a fresh login shouldn't
        // leave old browser tabs/devices holding a still-valid token forever.
        $user->tokens()->delete();
        $token = $user->createToken('internova-session')->plainTextToken;
        // Only feeds the Dean's "last active" — a failure here must never block signing in.
        rescue(fn () => $user->forceFill(['last_login_at' => now()])->saveQuietly());

        return response()->json([
            'success' => true,
            'token'   => $token,
            'user'    => $this->buildUserPayload($user),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()?->currentAccessToken()?->delete();

        return response()->json(['success' => true]);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'current_password' => 'required|string',
            'new_password'     => 'required|string|min:8|confirmed',
        ]);

        $user = $request->user();

        if (!Hash::check($data['current_password'], $user->password)) {
            return response()->json(['success' => false, 'message' => 'Current password is incorrect.'], 422);
        }

        $user->update(['password' => Hash::make($data['new_password'])]);

        // Sign out every other device/tab still holding an old token, but keep
        // this session's own token valid so changing your password doesn't
        // immediately log you out of the screen you just did it from.
        $user->tokens()->where('id', '!=', $user->currentAccessToken()->id)->delete();

        return response()->json(['success' => true, 'message' => 'Password updated.']);
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $data = $request->validate([
            'first_name' => 'required|string|max:100',
            'last_name'  => 'required|string|max:100',
            'phone'      => 'nullable|string|regex:/^[0-9]{11}$/',
        ]);

        $user = $request->user();
        $user->update([
            'first_name' => trim($data['first_name']),
            'last_name'  => trim($data['last_name']),
            // Kept in sync since some views still read the plain `name`
            // column as a fallback (see buildUserPayload below).
            'name'       => trim("{$data['first_name']} {$data['last_name']}"),
            'phone'      => $data['phone'] ?? null,
        ]);

        return response()->json(['success' => true, 'user' => $this->buildUserPayload($user->fresh())]);
    }

    public function uploadAvatar(Request $request): JsonResponse
    {
        $request->validate(['avatar' => 'required|image|mimes:jpg,jpeg,png,webp,gif|max:10240']);

        $user = $request->user();

        if ($user->profile_photo) {
            Storage::disk('public')->delete($user->profile_photo);
        }

        $path = $request->file('avatar')->store("avatars/{$user->id}", 'public');
        $user->update(['profile_photo' => $path]);

        return response()->json(['success' => true, 'user' => $this->buildUserPayload($user->fresh())]);
    }

    public function deleteAvatar(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->profile_photo) {
            Storage::disk('public')->delete($user->profile_photo);
            $user->update(['profile_photo' => null]);
        }

        return response()->json(['success' => true, 'user' => $this->buildUserPayload($user->fresh())]);
    }

    /**
     * Re-reads the current account/school/subscription state for an already
     * logged-in user (no password re-entry). The frontend calls this on every
     * load of a gated workspace instead of trusting the snapshot cached in
     * localStorage at login time — e.g. a coordinator who was pending_approval
     * needs to find out they were approved without having to log out and back in.
     */
    public function session(Request $request, int $id): JsonResponse
    {
        // A valid token only proves who you are, not that you're allowed to read
        // someone else's account — without this check any logged-in user could
        // page through every id and read another account's subscription details.
        if ($request->user()->id !== $id) {
            return response()->json(['success' => false, 'message' => 'Forbidden.'], 403);
        }

        $user = User::with(['roles', 'coordinatorProfile', 'deanProfile', 'school.subscriptions.plan'])->find($id);

        if (!$user) {
            return response()->json(['success' => false, 'message' => 'Account not found.'], 404);
        }

        return response()->json([
            'success' => true,
            'user'    => $this->buildUserPayload($user),
        ]);
    }

    private function buildUserPayload(User $user): array
    {
        // The subscription that governs current access — not just "whatever row is
        // newest," so a pending upgrade payment never locks a coordinator out of the
        // plan they're already paying for (see School::currentSubscription()).
        $subscription = $user->school?->currentSubscription();
        $pendingUpgrade = $user->school?->pendingUpgrade();
        $approvedChange = $user->school?->approvedChange();

        return [
            'id'         => $user->id,
            'name'       => trim("{$user->first_name} {$user->last_name}") ?: $user->name,
            'first_name' => $user->first_name,
            'last_name'  => $user->last_name,
            'phone'      => $user->phone,
            'email'      => $user->email,
            'avatar_url' => $user->avatar_url,
            'role'       => $user->roles?->name,
            'status'     => $user->status,
            'school_id'  => $user->school_id,
            'school_name' => $user->school?->school_name,
            'school_status' => $user->school?->status,
            'school_suspended' => $user->school?->is_suspended ?? false,
            'is_primary_coordinator' => $user->coordinatorProfile?->is_primary_coordinator ?? false,
            'dean_position' => $user->deanProfile?->position,
            'subscription_status' => $subscription?->effectiveStatus(),
            'subscription_plan'   => $subscription?->plan?->name,
            'subscription_billing_period' => $subscription?->billing_period,
            'subscription_amount' => $subscription?->amount,
            'subscription_start_date' => $subscription?->start_date?->format('F d, Y'),
            'subscription_end_date'   => $subscription?->end_date?->format('F d, Y'),
            'offer_expires_at'    => $subscription?->offer_expires_at?->format('F d, Y'),
            'payment_method'      => $subscription?->payment_method,
            'payment_status'      => $subscription?->payment_status,
            'payment_reference'   => $subscription?->payment_reference,
            // What this school's current plan actually unlocks — see
            // App\Services\PlanFeatures. Frontend gates use this directly
            // (e.g. plan_features.includes('Subtasks')); every gated backend
            // endpoint re-checks it independently, since hiding a control
            // client-side is never the real enforcement.
            'scheduled_switch'    => $user->school ? \App\Services\SubscriptionRollover::summary(\App\Services\SubscriptionRollover::scheduledFor($user->school)) : null,
            'subscription_breakdown' => $subscription ? \App\Services\SubscriptionBreakdown::forSubscription($subscription) : null,
            'plan_features'       => $subscription?->plan?->features ?? [],
            'approved_change'     => $approvedChange ? [
                'plan'           => $approvedChange->plan?->name,
                'billing_period' => $approvedChange->billing_period,
                'amount'         => (float) $approvedChange->amount,
                'breakdown'      => \App\Services\SubscriptionBreakdown::forSubscription($approvedChange),
            ] : null,
            'pending_upgrade'     => $pendingUpgrade ? [
                'plan'            => $pendingUpgrade->plan?->name,
                'billing_period'  => $pendingUpgrade->billing_period,
                'amount'          => $pendingUpgrade->amount,
                'payment_method'  => $pendingUpgrade->payment_method,
                'payment_status'  => $pendingUpgrade->payment_status,
                'payment_reference' => $pendingUpgrade->payment_reference,
                'breakdown'       => \App\Services\SubscriptionBreakdown::forPendingUpgrade($pendingUpgrade),
            ] : null,
        ];
    }
}
