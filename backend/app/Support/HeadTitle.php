<?php

namespace App\Support;

use App\Models\DeanProfile;
use App\Models\PlanInquiry;
use App\Models\User;

/**
 * What the school's head calls themselves: "Dean", "Principal" or "School Head".
 * It is picked on the registration form (plan_inquiries.position), copied to
 * dean_profiles.position when the school is created, and is the ONLY thing that
 * changes on screen: the role key stays 'dean' in routes, permissions and the DB.
 * Every message that names the head goes through here so the word is never hard-coded.
 */
class HeadTitle
{
    public const DEFAULT = 'Dean';

    /** Same list as POSITIONS in frontend/src/app/inquiry/page.jsx. */
    public const OPTIONS = ['Dean', 'Principal', 'School Head'];

    /** Maps whatever is stored (any casing, spaces) onto one allowed option; unknown or empty -> Dean. */
    public static function normalize(?string $value): string
    {
        $needle = mb_strtolower(preg_replace('/\s+/', ' ', trim((string) $value)));
        foreach (self::OPTIONS as $option) {
            if (mb_strtolower($option) === $needle) {
                return $option;
            }
        }

        return self::DEFAULT;
    }

    /** The title of a school's Dean account (the first one), or 'Dean' when it has none yet. */
    public static function forSchool(?int $schoolId): string
    {
        if (!$schoolId) {
            return self::DEFAULT;
        }

        return self::normalize(DeanProfile::where('school_id', $schoolId)->orderBy('id')->value('position'));
    }

    /**
     * The title for a dean user. A dean whose school is not created yet has no
     * profile, so their registration form answer is used.
     */
    public static function forDean(User $user): string
    {
        $position = $user->deanProfile?->position
            ?: PlanInquiry::where('user_id', $user->id)->orderByDesc('id')->value('position');

        return self::normalize($position);
    }

    /** "your Dean" / "your Principal" for sentences, with the article lowercase. */
    public static function yours(?int $schoolId): string
    {
        return 'your ' . self::forSchool($schoolId);
    }
}
