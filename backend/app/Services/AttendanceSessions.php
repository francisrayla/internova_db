<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\Company;
use Illuminate\Support\Collection;

/**
 * Works out what an intern should do next, given how the company records
 * attendance (Company::attendance_mode) and what is already logged that day.
 *
 *   single: Time in -> Time out
 *   split:  Morning in -> Morning out -> Afternoon in -> Afternoon out
 *
 * A day that already has rows keeps the style it started in, so changing the
 * company's setting at lunchtime never leaves an intern half way through.
 */
class AttendanceSessions
{
    public const SINGLE = 'single';
    public const SPLIT = 'split';

    public static function modeFor(?Company $company): string
    {
        return $company?->attendance_mode === self::SPLIT ? self::SPLIT : self::SINGLE;
    }

    /** Which style applies to a day: the style its rows already use, else the company's. */
    public static function dayMode(string $companyMode, Collection $rows): string
    {
        if ($rows->contains(fn (Attendance $a) => $a->session === Attendance::FULL)) {
            return self::SINGLE;
        }
        if ($rows->contains(fn (Attendance $a) => in_array($a->session, [Attendance::AM, Attendance::PM], true))) {
            return self::SPLIT;
        }

        return $companyMode === self::SPLIT ? self::SPLIT : self::SINGLE;
    }

    public static function label(string $session, string $action): string
    {
        $what = $action === 'clock_in' ? 'time in' : 'time out';

        return match ($session) {
            Attendance::AM => 'Morning ' . $what,
            Attendance::PM => 'Afternoon ' . $what,
            default => ucfirst($what),
        };
    }

    /**
     * The next punch for the day, or null when the day is complete.
     *
     * @return array{action:string, session:string, label:string}|null
     */
    public static function next(string $companyMode, Collection $rows): ?array
    {
        $mode = self::dayMode($companyMode, $rows);
        $step = fn (string $action, string $session) => ['action' => $action, 'session' => $session, 'label' => self::label($session, $action)];

        $order = $mode === self::SPLIT ? [Attendance::AM, Attendance::PM] : [Attendance::FULL];
        foreach ($order as $session) {
            $row = $rows->firstWhere('session', $session);
            if (!$row || !$row->clock_in) {
                return $step('clock_in', $session);
            }
            if (!$row->clock_out) {
                return $step('clock_out', $session);
            }
        }

        return null;
    }

    /** All the punches of a day, in order, for the "today" card. */
    public static function steps(string $companyMode, Collection $rows): array
    {
        $mode = self::dayMode($companyMode, $rows);
        $order = $mode === self::SPLIT ? [Attendance::AM, Attendance::PM] : [Attendance::FULL];
        $out = [];
        foreach ($order as $session) {
            $row = $rows->firstWhere('session', $session);
            foreach (['clock_in', 'clock_out'] as $action) {
                $out[] = [
                    'session' => $session,
                    'action' => $action,
                    'label' => self::label($session, $action),
                    'time' => $row?->{$action}?->local()?->format('h:i A'),
                ];
            }
        }

        return $out;
    }
}
