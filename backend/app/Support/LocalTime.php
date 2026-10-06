<?php

namespace App\Support;

use Illuminate\Support\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder;

/**
 * One display/business timezone for the whole app.
 *
 * Storage stays in UTC (config app.timezone). Everything a person reads, and
 * every "today" / day boundary, goes through here so the Philippine calendar
 * day is used instead of the UTC one (a 08:00 Manila clock-in is 00:00 UTC).
 */
class LocalTime
{
    public static function tz(): string
    {
        return config('app.display_timezone', 'Asia/Manila');
    }

    /** Current moment, expressed in the display timezone. */
    public static function now(): Carbon
    {
        return Carbon::now(self::tz());
    }

    /** Today's local calendar date as Y-m-d. */
    public static function today(): string
    {
        return self::now()->toDateString();
    }

    /**
     * Today's local date as a midnight Carbon in the app timezone (UTC), so it
     * can be compared with date-cast columns (attendance_date etc.) safely.
     */
    public static function todayDate(): Carbon
    {
        return Carbon::parse(self::today(), config('app.timezone'))->startOfDay();
    }

    /** Local calendar date (Y-m-d) of a stored/UTC moment. */
    public static function date(mixed $dt): ?string
    {
        $c = self::carbon($dt);

        return $c?->copy()->setTimezone(self::tz())->toDateString();
    }

    /** Local clock time, e.g. "08:01 AM". */
    public static function time(mixed $dt, string $fmt = 'h:i A'): ?string
    {
        return self::format($dt, $fmt);
    }

    public static function format(mixed $dt, string $fmt): ?string
    {
        $c = self::carbon($dt);

        return $c?->copy()->setTimezone(self::tz())->format($fmt);
    }

    /** Same instant in the display timezone (for ->format()/date math). */
    public static function of(mixed $dt): ?Carbon
    {
        $c = self::carbon($dt);

        return $c ? Carbon::instance($c)->setTimezone(self::tz()) : null;
    }

    /** [start, end] of a local calendar day as UTC Carbon instants. */
    public static function dayBounds(string $localDate): array
    {
        $start = Carbon::parse($localDate, self::tz())->startOfDay();

        return [$start->copy()->utc(), $start->copy()->endOfDay()->utc()];
    }

    /** Where a stored datetime column falls on a given local calendar day. */
    public static function whereLocalDate(Builder|EloquentBuilder $q, string $column, string $localDate): Builder|EloquentBuilder
    {
        [$s, $e] = self::dayBounds($localDate);

        return $q->whereBetween($column, [$s, $e]);
    }

    /** Parse a stored (UTC) or offset-carrying value into a Carbon; null-safe. */
    private static function carbon(mixed $dt): ?CarbonInterface
    {
        if ($dt === null || $dt === '') {
            return null;
        }

        return $dt instanceof CarbonInterface ? $dt : Carbon::parse($dt, config('app.timezone'));
    }
}
