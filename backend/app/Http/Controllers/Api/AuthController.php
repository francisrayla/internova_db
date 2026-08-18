<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
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

        $user = User::with(['roles', 'coordinatorProfile', 'school.subscriptions.plan'])->where('email', $data['email'])->first();

        if (!$user || !$user->password || !Hash::check($data['password'], $user->password)) {
            return response()->json(['success' => false, 'message' => 'Invalid email or password.'], 401);
        }

        // Replace any tokens from previous sessions — a fresh login shouldn't
        // leave old browser tabs/devices holding a still-valid token forever.
        $user->tokens()->delete();
        $token = $user->createToken('internova-session')->plainTextToken;

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

    public function uploadAvatar(Request $request): JsonResponse
    {
        $request->validate(['avatar' => 'required|image|mimes:jpg,jpeg,png,webp|max:3072']);

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

        $user = User::with(['roles', 'coordinatorProfile', 'school.subscriptions.plan'])->find($id);

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

        return [
            'id'         => $user->id,
            'name'       => trim("{$user->first_name} {$user->last_name}") ?: $user->name,
            'email'      => $user->email,
            'avatar_url' => $user->avatar_url,
            'role'       => $user->roles?->name,
            'status'     => $user->status,
            'school_id'  => $user->school_id,
            'school_name' => $user->school?->school_name,
            'school_status' => $user->school?->status,
            'school_suspended' => $user->school?->is_suspended ?? false,
            'is_primary_coordinator' => $user->coordinatorProfile?->is_primary_coordinator ?? false,
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
            'pending_upgrade'     => $pendingUpgrade ? [
                'plan'            => $pendingUpgrade->plan?->name,
                'billing_period'  => $pendingUpgrade->billing_period,
                'amount'          => $pendingUpgrade->amount,
                'payment_method'  => $pendingUpgrade->payment_method,
                'payment_status'  => $pendingUpgrade->payment_status,
                'payment_reference' => $pendingUpgrade->payment_reference,
            ] : null,
        ];
    }
}
