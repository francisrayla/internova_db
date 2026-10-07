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

class PasswordResetController extends Controller
{
    private const EXPIRES_IN_MINUTES = 15;

    /**
     * Sends a recovery code, but only to an email that really has an account that can sign in:
     * anything else is told so, so a mistyped address is noticed instead of waiting for a code
     * that will never come. (This does reveal which emails are registered; the route is
     * throttled to 10 requests a minute to keep guessing slow.)
     */
    public function forgotPassword(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => 'required|email']);

        $user = User::where('email', $data['email'])->first();

        if (!$user) {
            return response()->json(['success' => false, 'message' => "We couldn't find an account with that email. Check the spelling, or ask your school."], 422);
        }
        if ($user->status === 'inactive') {
            return response()->json(['success' => false, 'message' => 'This account has been deactivated. Please contact your school.'], 422);
        }
        if (!$user->password) {
            return response()->json(['success' => false, 'message' => "This account isn't active yet. Open the invitation email we sent you to set your password."], 422);
        }

        if (EmailVerificationController::sentRecently('password_reset_tokens', $user->email)) {
            return response()->json(['success' => true, 'message' => 'A code was just sent. Please check your inbox, including Spam.']);
        }

        $code = (string) random_int(100000, 999999);

        DB::table('password_reset_tokens')->updateOrInsert(
            ['email' => $user->email],
            ['token' => hash('sha256', $code), 'created_at' => now()]
        );

        Mail::to($user->email, $user->name)->queue(new PasswordResetMail(
            recipientName: trim("{$user->first_name} {$user->last_name}") ?: $user->name,
            code: $code,
            expiresInMinutes: (string) self::EXPIRES_IN_MINUTES,
        ));

        return response()->json(['success' => true, 'message' => 'A recovery code has been sent to your email.']);
    }

    private function findValidCodeRow(string $email, string $code): ?object
    {
        $row = DB::table('password_reset_tokens')->where('email', $email)->first();

        if (!$row || $row->token !== hash('sha256', $code)) {
            return null;
        }
        if (now()->diffInMinutes($row->created_at) > self::EXPIRES_IN_MINUTES) {
            DB::table('password_reset_tokens')->where('email', $email)->delete();
            return null;
        }

        return $row;
    }

    /**
     * Just the code-entry step's own check — lets the frontend advance to
     * "set a new password" only once the code is actually right, without
     * yet consuming it (the final resetPassword() call re-validates it
     * again before actually changing anything, since a client-side "it was
     * valid a moment ago" is never enough on its own).
     */
    public function verifyResetCode(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => 'required|email',
            'code' => 'required|string',
        ]);

        if (!$this->findValidCodeRow($data['email'], $data['code'])) {
            return response()->json(['success' => false, 'message' => 'That code is incorrect or has expired.'], 422);
        }

        return response()->json(['success' => true]);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => 'required|email',
            'code' => 'required|string',
            'password' => 'required|string|min:8|confirmed',
        ]);

        if (!$this->findValidCodeRow($data['email'], $data['code'])) {
            return response()->json(['success' => false, 'message' => 'That code is incorrect or has expired.'], 422);
        }

        $user = User::where('email', $data['email'])->first();
        if (!$user) {
            return response()->json(['success' => false, 'message' => 'Account not found.'], 404);
        }

        $user->update([
            'password' => Hash::make($data['password']),
            // Entering a code sent to this address proves the same thing
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
