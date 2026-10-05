<?php

namespace App\Services;

use App\Models\Role;
use App\Models\User;

/**
 * Finds a school's single Dean and single (active or pending) Coordinator.
 * Roles are always looked up by name — their ids differ between environments.
 */
class SchoolStaff
{
    /** Statuses that still count as "the school has a coordinator". */
    public const OCCUPYING_STATUSES = ['active', 'pending_activation'];

    public static function roleId(string $name): ?int
    {
        return Role::where('name', $name)->value('id');
    }

    public static function dean(?int $schoolId): ?User
    {
        if (!$schoolId || !($roleId = self::roleId('dean'))) {
            return null;
        }

        return User::where('school_id', $schoolId)->where('role_id', $roleId)->orderBy('id')->first();
    }

    /** The coordinator who currently holds the school's single seat, if any. */
    public static function coordinator(?int $schoolId): ?User
    {
        if (!$schoolId || !($roleId = self::roleId('coordinator'))) {
            return null;
        }

        return User::where('school_id', $schoolId)
            ->where('role_id', $roleId)
            ->whereIn('status', self::OCCUPYING_STATUSES)
            ->orderBy('id')
            ->first();
    }

    /** accepted | pending | inactive — how far along an invited account is. */
    public static function accountState(?User $user): ?string
    {
        if (!$user) {
            return null;
        }
        if ($user->status === 'inactive') {
            return 'inactive';
        }

        return is_null($user->password) ? 'pending' : 'active';
    }
}
