<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\EmailVerification as EmailVerificationMail;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class EmailVerificationController extends Controller
{
    private const EXPIRES_IN_MINUTES = 15;

    /**
     * Shared by storeInquiry() right after account creation and by
     * resend() — generates a fresh code, stores it, and queues the email.
     */
    public static function sendCode(User $user): void
    {
        $code = (string) random_int(100000, 999999);

        DB::table('email_verification_tokens')->updateOrInsert(
            ['email' => $user->email],
            ['token' => hash('sha256', $code), 'created_at' => now()]
        );

        Mail::to($user->email, $user->name)->queue(new EmailVerificationMail(
            recipientName: trim("{$user->first_name} {$user->last_name}") ?: $user->name,
            code: $code,
            expiresInMinutes: (string) self::EXPIRES_IN_MINUTES,
        ));
    }

    private function findValidCodeRow(string $email, string $code): ?object
    {
        $row = DB::table('email_verification_tokens')->where('email', $email)->first();

        if (!$row || $row->token !== hash('sha256', $code)) {
            return null;
        }
        if (now()->diffInMinutes($row->created_at) > self::EXPIRES_IN_MINUTES) {
            DB::table('email_verification_tokens')->where('email', $email)->delete();
            return null;
        }

        return $row;
    }

    public function verify(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => 'required|email',
            'code' => 'required|string',
        ]);

        if (!$this->findValidCodeRow($data['email'], $data['code'])) {
            return response()->json(['success' => false, 'message' => 'That code is incorrect or has expired.'], 422);
        }

        $user = User::where('email', $data['email'])->first();
        if (!$user) {
            return response()->json(['success' => false, 'message' => 'Account not found.'], 404);
        }

        $user->update(['email_verified_at' => $user->email_verified_at ?? now()]);

        DB::table('email_verification_tokens')->where('email', $data['email'])->delete();

        return response()->json(['success' => true, 'message' => 'Email verified. You can now log in.']);
    }

    /**
     * Always responds the same way whether or not the email exists or is
     * already verified — same anti-enumeration reasoning as
     * PasswordResetController::forgotPassword().
     */
    public function resend(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => 'required|email']);

        $user = User::where('email', $data['email'])->whereNull('email_verified_at')->first();

        if ($user) {
            self::sendCode($user);
        }

        return response()->json([
            'success' => true,
            'message' => 'If that email needs verification, a new code has been sent.',
        ]);
    }
}
