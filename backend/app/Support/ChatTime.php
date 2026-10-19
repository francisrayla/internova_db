<?php

namespace App\Support;

use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

/**
 * The time label the Messenger shows for a message, in Philippine time (LocalTime):
 *   today            "Today 6:40 PM"
 *   yesterday        "Yesterday 6:40 PM"
 *   earlier this week "Mon 6:40 PM"          (the weekday; the week starts on Monday)
 *   older            "Oct 13, 6:40 PM"         (with the year when it is not this year: "Oct 13, 2025, 6:40 PM")
 */
class ChatTime
{
    public static function label(CarbonInterface|string|null $moment, CarbonInterface|string|null $now = null): ?string
    {
        if ($moment === null) {
            return null;
        }

        $at = LocalTime::of($moment);
        $today = LocalTime::of($now ?? Carbon::now())->startOfDay();
        $time = $at->format('g:i A');
        $days = (int) $at->copy()->startOfDay()->diffInDays($today, false); // 0 today, 1 yesterday, negative = future

        return match (true) {
            $days === 0 => "Today {$time}",
            $days === 1 => "Yesterday {$time}",
            $days >= 2 && $at->copy()->startOfWeek()->equalTo($today->copy()->startOfWeek()) => $at->format('D') . " {$time}",
            $at->year === $today->year => $at->format('M j') . ", {$time}",
            default => $at->format('M j, Y') . ", {$time}",
        };
    }
}
