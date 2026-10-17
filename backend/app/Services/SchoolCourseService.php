<?php

namespace App\Services;

use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\SchoolCourse;
use App\Support\Courses;
use Illuminate\Support\Facades\DB;

/**
 * The courses one school offers (table school_courses, edited under Settings -> Courses offered by the
 * coordinator or the head/dean). Only an offered course can be given to a NEW intern (add or import). Interns who
 * already have a course keep it when it stops being offered. required_hours NULL = the catalog default.
 */
class SchoolCourseService
{
    public const MAX_COURSES = 100;
    public const MAX_NAME_LENGTH = 150;
    public const MIN_HOURS = 1;
    public const MAX_HOURS = 2000;
    /** Letters, numbers, spaces and . , & ( ) - ' */
    public const NAME_PATTERN = "/^[\\p{L}\\p{M}\\p{N} .,&()'\\-]+\$/u";

    public const MSG_NOT_OFFERED = "This course isn't offered by your school. Add it in Settings → Courses offered.";
    public const MSG_NONE_YET = "Your school hasn't set up its courses yet. Set them in Settings → Courses offered first.";

    /** Comparison key: the canonical full name, lowercase, spaces collapsed ("BSIT" and its full name match). */
    public static function key(?string $course): string
    {
        return CourseRequirementService::courseKey($course);
    }

    /** @return \Illuminate\Support\Collection<int, SchoolCourse> in the school's own order */
    public static function offered(int $schoolId)
    {
        return SchoolCourse::where('school_id', $schoolId)->orderBy('sort_order')->orderBy('id')->get();
    }

    /** @return array<string, SchoolCourse> offered courses keyed by self::key() */
    public static function index(int $schoolId): array
    {
        $out = [];
        foreach (self::offered($schoolId) as $row) {
            $out[self::key($row->name)] = $row;
        }

        return $out;
    }

    public static function find(int $schoolId, ?string $course): ?SchoolCourse
    {
        return self::index($schoolId)[self::key($course)] ?? null;
    }

    /** Why this course can't be given to a new intern of the school (null = fine). $index from self::index(). */
    public static function problem(array $index, ?string $course): ?string
    {
        if ($index === []) {
            return self::MSG_NONE_YET;
        }
        $key = self::key($course);

        return ($key === '' || !isset($index[$key])) ? self::MSG_NOT_OFFERED : null;
    }

    /** Required hours for a new intern: the school's figure, else the catalog default, else 500. */
    public static function hours(array $index, ?string $course): int
    {
        $row = $index[self::key($course)] ?? null;

        return $row?->required_hours ?: Courses::defaultHours($course);
    }

    /** @return array<string, array{name:string, interns:int}> intern counts per course (keyed by self::key()) */
    public static function internCounts(int $schoolId): array
    {
        $counts = [];
        foreach (InternProfile::where('school_id', $schoolId)->whereNotNull('course')->pluck('course') as $c) {
            $name = Courses::canonical($c);
            if ($name === null || $name === '') {
                continue;
            }
            $k = self::key($name);
            $counts[$k] = ['name' => $counts[$k]['name'] ?? $name, 'interns' => ($counts[$k]['interns'] ?? 0) + 1];
        }

        return $counts;
    }

    /** What both Settings screens read. */
    public static function payload(int $schoolId): array
    {
        $counts = self::internCounts($schoolId);
        $offered = [];
        $seen = [];
        foreach (self::offered($schoolId) as $row) {
            $k = self::key($row->name);
            $seen[$k] = true;
            $default = Courses::defaultHours($row->name);
            $code = Courses::codeFor($row->name);
            $offered[] = [
                'name' => $row->name,
                'code' => $code,
                'custom' => $code === null,
                'required_hours' => $row->required_hours,
                'default_hours' => $default,
                'hours' => $row->required_hours ?: $default,
                'interns_count' => $counts[$k]['interns'] ?? 0,
            ];
        }
        $unlisted = [];
        foreach ($counts as $k => $c) {
            if (!isset($seen[$k])) {
                $unlisted[] = ['name' => $c['name'], 'interns_count' => $c['interns']];
            }
        }
        usort($unlisted, fn ($a, $b) => strcasecmp($a['name'], $b['name']));

        return [
            'success' => true,
            'catalog' => Courses::catalog(),
            'offered' => $offered,
            'unlisted' => $unlisted,
            'limits' => [
                'max_courses' => self::MAX_COURSES,
                'max_name_length' => self::MAX_NAME_LENGTH,
                'min_hours' => self::MIN_HOURS,
                'max_hours' => self::MAX_HOURS,
                'default_hours' => Courses::DEFAULT_HOURS,
            ],
        ];
    }

    /**
     * Replace the offered list. $items = [['name' => canonical, 'required_hours' => ?int], ...] already validated,
     * canonicalized and free of duplicates. When the hours of a course already offered change, the interns who
     * already have that course follow (see self::applyHours()). Returns [added names, removed names, interns updated].
     *
     * @return array{0: array<int,string>, 1: array<int,string>, 2: int}
     */
    public static function replace(int $schoolId, array $items): array
    {
        return DB::transaction(function () use ($schoolId, $items) {
            $existing = SchoolCourse::where('school_id', $schoolId)->lockForUpdate()->get()->keyBy(fn ($r) => self::key($r->name));
            $keep = [];
            $added = [];
            $newHours = [];
            foreach (array_values($items) as $i => $item) {
                $k = self::key($item['name']);
                $keep[$k] = true;
                if ($row = $existing->get($k)) {
                    $before = $row->required_hours ?: Courses::defaultHours($row->name);
                    $after = $item['required_hours'] ?: Courses::defaultHours($item['name']);
                    if ($before !== $after) {
                        $newHours[$k] = $after;
                    }
                    $row->update(['name' => $item['name'], 'required_hours' => $item['required_hours'], 'sort_order' => $i]);
                } else {
                    SchoolCourse::create(['school_id' => $schoolId, 'name' => $item['name'], 'required_hours' => $item['required_hours'], 'sort_order' => $i]);
                    $added[] = $item['name'];
                }
            }
            $removed = [];
            foreach ($existing as $k => $row) {
                if (!isset($keep[$k])) {
                    $removed[] = $row->name;
                    $row->delete();
                }
            }

            return [$added, $removed, self::applyHours($schoolId, $newHours)];
        });
    }

    /**
     * Give the school's interns of each course its new required hours: the profile and the deployment. Interns
     * already marked completed keep theirs, so a finished internship (and its certificate) is not reopened.
     * $hours = [course key => hours]. Returns how many interns changed.
     */
    public static function applyHours(int $schoolId, array $hours): int
    {
        if ($hours === []) {
            return 0;
        }
        $updated = 0;
        foreach (InternProfile::where('school_id', $schoolId)->whereNotNull('course')->get(['id', 'user_id', 'course', 'required_hours']) as $profile) {
            $target = $hours[self::key($profile->course)] ?? null;
            if ($target === null) {
                continue;
            }
            $deployments = InternshipDeployment::where('school_id', $schoolId)->where('intern_id', $profile->user_id)->get(['id', 'status', 'required_hours']);
            $open = $deployments->where('status', '!=', 'completed');
            if ($deployments->isNotEmpty() && $open->isEmpty()) {
                continue; // finished: keeps the hours it was completed with
            }
            $changed = false;
            foreach ($open as $deployment) {
                if ((int) $deployment->required_hours !== $target) {
                    InternshipDeployment::whereKey($deployment->id)->update(['required_hours' => $target]);
                    $changed = true;
                }
            }
            if ((int) $profile->required_hours !== $target) {
                $profile->update(['required_hours' => $target]);
                $changed = true;
            }
            $updated += $changed ? 1 : 0;
        }

        return $updated;
    }
}
