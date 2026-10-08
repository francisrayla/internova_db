<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\Company;
use Illuminate\Support\Carbon;

/**
 * Checks a clock-in/out location on the server instead of trusting what the phone says. An intern may clock
 * in from anywhere (field work, a client site): there is NO distance limit, and the distance to the company
 * is only recorded for the reviewer. What is refused is a location that looks forged.
 *
 * A browser cannot tell a real GPS fix from a fake one, so this does what a server can:
 *  - the page tells us when it found the browser's location functions replaced by script (location_tampering);
 *  - the phone cannot have travelled from the previous punch to this one at an impossible speed (impossible_travel);
 *  - a fix must be fresh and not hopelessly imprecise;
 *  - and it flags, without refusing, the patterns fake-GPS apps leave (an "accuracy" of exactly 1 m, or the very
 *    same coordinates to the last decimal at GPS-grade accuracy, punch after punch).
 *
 * Only an online clock-in is ever refused. A clock-out and anything captured offline is saved and flagged, since
 * refusing it would lose the entry or strand a shift that is open. A mock-location app set to a believable
 * place cannot be told from a real phone by any web page; that needs a native app, so the flags and the
 * supervisor's review of the selfie remain the second line.
 */
class AttendanceLocationService
{
    /** A location fix older than this (seconds) is not "where you are now". */
    public const MAX_FIX_AGE_SECONDS = 120;

    /** A fix less precise than this (metres) says almost nothing about where the phone is. */
    public const MAX_ACCURACY_M = 250;

    /** Faster than this (km/h) between two punches is not a person travelling. */
    public const MAX_TRAVEL_KMH = 300;

    /** Below this distance (km) the speed check is skipped: it is only GPS noise. */
    public const MIN_TRAVEL_KM = 5;

    /** This many punches in a row at the exact same coordinates looks like a fixed fake position. */
    public const REPEAT_RUN = 3;

    /** Identical coordinates only mean something at GPS-grade accuracy (Wi-Fi positioning repeats itself). */
    public const REPEAT_MAX_ACCURACY_M = 30;

    public const FLAG_LABELS = [
        'location_tampering' => 'Location functions were altered',
        'impossible_travel' => 'Impossible travel from the last punch',
        'repeated_coordinates' => 'Same exact coordinates as the last punches',
        'perfect_accuracy' => 'Unusual GPS reading',
        'weak_signal' => 'Weak GPS signal',
        'old_fix' => 'Old location fix',
    ];

    /**
     * @return array{distance_m:?int,accuracy_m:?int,flags:array<int,string>,block:?array{code:string,message:string}}
     */
    public static function assess(
        ?Company $company,
        float $lat,
        float $lng,
        ?float $accuracy,
        ?float $fixAgeSeconds,
        bool $offline,
        ?int $deploymentId,
        string $punch,
        bool $mayBlock,
        bool $tampered = false,
        ?Carbon $at = null,
    ): array {
        $flags = [];
        $block = null;
        $fake = 'Your location looks fake or altered, so this cannot be saved. Turn off any fake GPS or location-changing app or extension and try again. If you are really there, ask your supervisor to log your attendance.';

        $accuracyM = $accuracy !== null ? (int) round($accuracy) : null;

        // Only for the reviewer: how far from the company's map pin. Never a reason to refuse.
        $distance = null;
        if ($company && $company->latitude !== null && $company->longitude !== null) {
            $distance = (int) round(self::metersBetween($lat, $lng, (float) $company->latitude, (float) $company->longitude));
        }

        if ($tampered) {
            $flags[] = 'location_tampering';
            $block ??= ['code' => 'location_fake', 'message' => $fake];
        }

        if ($deploymentId && $at && self::impossibleTravel($deploymentId, $lat, $lng, $at)) {
            $flags[] = 'impossible_travel';
            $block ??= ['code' => 'location_fake', 'message' => $fake];
        }

        if ($fixAgeSeconds !== null && $fixAgeSeconds > self::MAX_FIX_AGE_SECONDS) {
            $flags[] = 'old_fix';
            $block ??= ['code' => 'location_old', 'message' => 'Your location is out of date. Turn on your GPS, wait a moment, and try again.'];
        }
        if ($accuracyM !== null && $accuracyM > self::MAX_ACCURACY_M) {
            $flags[] = 'weak_signal';
            $block ??= ['code' => 'location_weak', 'message' => "Your GPS signal is too weak (about {$accuracyM} m off). Move to an open area and try again."];
        }

        // Fake GPS apps usually report a perfect fix, and the same position every single time.
        if ($accuracy !== null && $accuracy <= 1.0) {
            $flags[] = 'perfect_accuracy';
        }
        if ($deploymentId && $accuracy !== null && $accuracy <= self::REPEAT_MAX_ACCURACY_M && self::repeatsLastPunches($deploymentId, $punch, $lat, $lng)) {
            $flags[] = 'repeated_coordinates';
        }

        // Refused only when it can be put right on the spot: an online clock-in.
        $refuse = $mayBlock && !$offline && $punch === 'clock_in';

        return [
            'distance_m' => $distance,
            'accuracy_m' => $accuracyM,
            'flags' => array_values(array_unique($flags)),
            'block' => $refuse ? $block : null,
        ];
    }

    /** Great-circle distance in metres. */
    public static function metersBetween(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $r = 6371000;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return $r * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /**
     * True when the most recent punch of this deployment is so far from this one, for the time between them,
     * that nobody could have travelled it (a fake location moved between punches).
     */
    private static function impossibleTravel(int $deploymentId, float $lat, float $lng, Carbon $at): bool
    {
        $previous = null; // [lat, lng, Carbon]
        $rows = Attendance::where('deployment_id', $deploymentId)->orderByDesc('id')->limit(4)->get();
        foreach ($rows as $a) {
            foreach (['clock_out', 'clock_in'] as $p) {
                $t = $a->{$p};
                $plat = $a->{"{$p}_latitude"};
                if ($t && $plat !== null && $t->lte($at) && (!$previous || $t->gt($previous[2]))) {
                    $previous = [(float) $plat, (float) $a->{"{$p}_longitude"}, $t];
                }
            }
        }
        if (!$previous) {
            return false;
        }

        $km = self::metersBetween($previous[0], $previous[1], $lat, $lng) / 1000;
        if ($km < self::MIN_TRAVEL_KM) {
            return false;
        }
        // Under a minute apart counts as a minute, so a teleport between two quick punches is still caught.
        $hours = max(1, $previous[2]->diffInSeconds($at)) / 3600;
        $hours = max($hours, 1 / 60);

        return $km / $hours > self::MAX_TRAVEL_KMH;
    }

    /** True when the previous REPEAT_RUN - 1 punches of this kind were at exactly these coordinates. */
    private static function repeatsLastPunches(int $deploymentId, string $punch, float $lat, float $lng): bool
    {
        $latCol = "{$punch}_latitude";
        $lngCol = "{$punch}_longitude";

        $last = Attendance::where('deployment_id', $deploymentId)
            ->whereNotNull($latCol)
            ->orderByDesc('id')
            ->limit(self::REPEAT_RUN - 1)
            ->get([$latCol, $lngCol]);
        if ($last->count() < self::REPEAT_RUN - 1) {
            return false;
        }

        return $last->every(fn ($a) => round((float) $a->{$latCol}, 6) === round($lat, 6) && round((float) $a->{$lngCol}, 6) === round($lng, 6));
    }
}
