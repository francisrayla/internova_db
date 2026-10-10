<?php

use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Private broadcast channels
|--------------------------------------------------------------------------
| Every realtime channel is PRIVATE: the browser must authorize each subscription at
| POST /api/broadcasting/auth (Sanctum bearer token, see bootstrap/app.php), and the checks
| below decide who may listen. Nothing here trusts the channel name alone any more.
|
|   user.{id}.notifications  - personal notification pushes (App\Events\NotificationCreated)
|   user.{id}.messages       - chat for one person: DMs, group messages, typing (App\Events\MessageSent,
|                              GroupMessageSent, UserTyping, GroupUserTyping)
|   school.{schoolId}.{role}.notifications - everyone with that role in that one school
|   superadmin.notifications - platform admins only
|
| Chat is delivered per recipient (the server fans out to each member's own channel only after
| MessageController has checked who may talk to whom), so "own user id" is the whole membership check.
*/

Broadcast::channel('user.{id}.notifications', fn (User $user, $id) => (int) $user->id === (int) $id);

Broadcast::channel('user.{id}.messages', fn (User $user, $id) => (int) $user->id === (int) $id);

Broadcast::channel('school.{schoolId}.{role}.notifications', function (User $user, $schoolId, $role) {
    return $user->school_id !== null
        && (int) $user->school_id === (int) $schoolId
        && $user->roles?->name === $role;
});

Broadcast::channel('superadmin.notifications', fn (User $user) => $user->roles?->name === 'super_admin');
