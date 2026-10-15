<?php

use App\Support\HeadTitle;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The school head's title (Dean / Principal / School Head) lives in dean_profiles.position,
 * copied from plan_inquiries.position when the school is created. Older rows may be empty or
 * hold free text from before the form offered a fixed list: set them to the registration
 * choice when it is one of the allowed options, otherwise to 'Dean'. Data-only; no schema change.
 */
return new class extends Migration
{
    public function up(): void
    {
        $profiles = DB::table('dean_profiles')->select('id', 'user_id', 'position')->get();

        foreach ($profiles as $profile) {
            if (in_array($profile->position, HeadTitle::OPTIONS, true)) {
                continue;
            }

            $registered = DB::table('plan_inquiries')->where('user_id', $profile->user_id)->orderByDesc('id')->value('position');
            // Prefer what they chose on the form; otherwise tidy the stored value (casing) or fall back to Dean.
            $registeredTitle = HeadTitle::normalize($registered);
            $title = in_array(trim((string) $registered), HeadTitle::OPTIONS, true) ? $registeredTitle : HeadTitle::normalize($profile->position);

            DB::table('dean_profiles')->where('id', $profile->id)->update(['position' => $title]);
        }
    }

    /** Data-only normalisation: the previous free-text values are not kept, so there is nothing to restore. */
    public function down(): void
    {
    }
};
