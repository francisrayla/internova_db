<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InternProfile;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class InvitationController extends Controller
{
    private function findValidUser(string $token): ?User
    {
        return User::where('invitation_token', hash('sha256', $token))
            ->where('invitation_expires_at', '>', now())
            ->first();
    }

    public function show(string $token): JsonResponse
    {
        $user = $this->findValidUser($token);

        if (!$user) {
            return response()->json(['success' => false, 'message' => 'This invitation link is no longer valid. It may have been used already (then just log in), expired, or been replaced by a newer invitation.'], 404);
        }

        return response()->json([
            'success'      => true,
            'first_name'   => $user->first_name,
            'last_name'    => $user->last_name,
            'email'        => $user->email,
            'role'         => $user->roles?->name,
            'school_name'  => $user->school?->school_name,
            // Interns enter their own student number here — it's their
            // school record, so the coordinator never has to type it in.
            'needs_student_number' => $user->roles?->name === 'intern',
        ]);
    }

    public function accept(Request $request, string $token): JsonResponse
    {
        $user = $this->findValidUser($token);

        if (!$user) {
            return response()->json(['success' => false, 'message' => 'This invitation link is no longer valid. It may have been used already (then just log in), expired, or been replaced by a newer invitation.'], 404);
        }

        $isIntern = $user->roles?->name === 'intern';

        // Same shape the rest of the app uses: uppercase letters, digits and
        // hyphens, spaces dropped ("2022 00123" → "202200123").
        if ($isIntern) {
            $request->merge([
                'student_number' => strtoupper(str_replace(' ', '', (string) $request->input('student_number', ''))),
            ]);
        }

        $data = $request->validate([
            'password' => 'required|string|min:8|confirmed',
            'accept_terms' => 'accepted',
            'student_number' => $isIntern ? ['required', 'string', 'max:20', 'regex:/^[A-Z0-9-]+$/'] : ['prohibited'],
        ], [
            'accept_terms.accepted' => 'You need to agree to the Terms and Conditions and the Privacy Notice to activate your account.',
            'student_number.required' => 'Enter your student number.',
            'student_number.regex' => 'Student number can only have letters, numbers and hyphens.',
        ]);

        if ($isIntern) {
            $taken = InternProfile::where('school_id', $user->school_id)
                ->where('user_id', '!=', $user->id)
                ->where('student_number', $data['student_number'])
                ->exists();
            if ($taken) {
                return response()->json([
                    'success' => false,
                    'message' => 'That student number is already used by another intern at your school. Check it, or contact your coordinator.',
                ], 422);
            }
        }

        DB::transaction(function () use ($user, $data, $isIntern) {
            $user->update([
                'password'               => Hash::make($data['password']),
                'status'                 => 'active',
                'email_verified_at'      => now(),
                'invitation_token'       => null,
                'invitation_expires_at'  => null,
                'terms_accepted_at'      => now(),
                'terms_version'          => config('internova.terms_version'),
            ]);

            if ($isIntern) {
                InternProfile::where('user_id', $user->id)->update(['student_number' => $data['student_number']]);
            }
        });

        return response()->json(['success' => true, 'message' => 'Account activated. You can now log in.']);
    }
}
