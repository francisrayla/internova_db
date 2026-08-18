<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\PasswordReset as PasswordResetMail;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class PasswordResetController extends Controller
{
    // Local dev only — matches the pattern already used in CoordinatorSubscriptionController.
    private const FRONTEND_URL = 'http://localhost:3000';
    private const EXPIRES_IN_MINUTES = 60;

    /**
     * Always responds the same way whether or not the email exists — telling
     * someone "no account found" would let them fish for which emails are
     * registered.
     */
    public function forgotPassword(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => 'required|email']);

        $user = User::where('email', $data['email'])->first();

        if ($user && $user->password) {
            $plainToken = Str::random(64);

            DB::table('password_reset_tokens')->updateOrInsert(
                ['email' => $user->email],
                ['token' => hash('sha256', $plainToken), 'created_at' => now()]
            );

            $resetUrl = self::FRONTEND_URL . '/reset-password?token=' . $plainToken . '&email=' . urlencode($user->email);

            Mail::to($user->email, $user->name)->send(new PasswordResetMail(
                recipientName: trim("{$user->first_name} {$user->last_name}") ?: $user->name,
                resetUrl: $resetUrl,
                expiresInMinutes: (string) self::EXPIRES_IN_MINUTES,
            ));
        }

        return response()->json([
            'success' => true,
            'message' => 'If that email is registered, a password reset link has been sent.',
        ]);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => 'required|email',
            'token' => 'required|string',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $row = DB::table('password_reset_tokens')->where('email', $data['email'])->first();

        if (!$row || $row->token !== hash('sha256', $data['token'])) {
            return response()->json(['success' => false, 'message' => 'This reset link is invalid or has already been used.'], 422);
        }

        if (now()->diffInMinutes($row->created_at) > self::EXPIRES_IN_MINUTES) {
            DB::table('password_reset_tokens')->where('email', $data['email'])->delete();
            return response()->json(['success' => false, 'message' => 'This reset link has expired. Please request a new one.'], 422);
        }

        $user = User::where('email', $data['email'])->first();
        if (!$user) {
            return response()->json(['success' => false, 'message' => 'Account not found.'], 404);
        }

        $user->update([
            'password' => Hash::make($data['password']),
            // Clicking a reset link sent to this address proves the same thing
            // email verification does — no reason to make them do it twice.
            'email_verified_at' => $user->email_verified_at ?? now(),
        ]);

        // A forgotten-password reset means the account may have been compromised
        // or the person lost access somewhere — sign out every existing session.
        $user->tokens()->delete();

        DB::table('password_reset_tokens')->where('email', $data['email'])->delete();

        return response()->json(['success' => true, 'message' => 'Password reset. You can now log in.']);
    }
}
