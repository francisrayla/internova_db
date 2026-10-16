<?php

namespace App\Support;

use App\Models\Setting;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * What every email shows about Internova itself: the address people reach support at (the Super Admin's
 * `support_email` system setting) and the web app link (the frontend, never the API host).
 */
final class MailBrand
{
    public static function supportEmail(): string
    {
        $email = trim((string) Setting::value('support_email', ''));

        return $email !== '' ? $email : (string) config('mail.from.address');
    }

    public static function appUrl(string $path = ''): string
    {
        return rtrim((string) config('app.frontend_url'), '/') . $path;
    }

    /** Active head-of-school accounts (role key `dean`) of a school: who receives billing emails. */
    public static function headsOf(int $schoolId): Collection
    {
        return User::where('school_id', $schoolId)
            ->whereHas('roles', fn ($q) => $q->where('name', 'dean'))
            ->whereNotIn('status', ['inactive'])
            ->get();
    }
}
