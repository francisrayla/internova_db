<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
            return response()->json(['success' => false, 'message' => 'This invitation link is invalid or has expired.'], 404);
        }

        return response()->json([
            'success'      => true,
            'first_name'   => $user->first_name,
            'last_name'    => $user->last_name,
            'email'        => $user->email,
            'role'         => $user->roles?->name,
            'school_name'  => $user->school?->school_name,
        ]);
    }

    public function accept(Request $request, string $token): JsonResponse
    {
        $user = $this->findValidUser($token);

        if (!$user) {
            return response()->json(['success' => false, 'message' => 'This invitation link is invalid or has expired.'], 404);
        }

        $data = $request->validate([
            'password' => 'required|string|min:8|confirmed',
        ]);

        $user->update([
            'password'               => Hash::make($data['password']),
            'status'                 => 'active',
            'email_verified_at'      => now(),
            'invitation_token'       => null,
            'invitation_expires_at'  => null,
        ]);

        // Only a coordinator accepting their own invite should move the school into
        // billing — a supervisor or intern accepting theirs has nothing to do with
        // the school's subscription.
        if ($user->school_id && $user->roles?->name === 'coordinator') {
            $user->school()->update(['status' => 'pending_payment']);
        }

        return response()->json(['success' => true, 'message' => 'Account activated. You can now log in.']);
    }
}
