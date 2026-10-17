<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ActivityLogService;
use App\Services\SchoolCourseService;
use App\Support\Courses;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * "Courses offered": the courses a school picks from the catalog (or types, for a program that is not in it).
 * The coordinator and the head/dean of the school share these endpoints (routes under /coordinator and /dean,
 * each behind its own role middleware); every query is scoped to the signed-in user's own school_id.
 */
class SchoolCourseController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(SchoolCourseService::payload((int) $request->user()->school_id));
    }

    /** Replace the offered list. A course interns already have may be removed: they keep it, it just stops being offered. */
    public function update(Request $request): JsonResponse
    {
        $schoolId = (int) $request->user()->school_id;
        $max = SchoolCourseService::MAX_COURSES;

        $data = $request->validate([
            'offered' => "present|array|max:{$max}",
            'offered.*' => 'required|array',
            'offered.*.name' => ['required', 'string', 'max:' . SchoolCourseService::MAX_NAME_LENGTH, 'regex:' . SchoolCourseService::NAME_PATTERN],
            'offered.*.required_hours' => 'nullable|integer|min:' . SchoolCourseService::MIN_HOURS . '|max:' . SchoolCourseService::MAX_HOURS,
        ], [
            'offered.max' => "A school can offer at most {$max} courses.",
            'offered.*.name.required' => 'A course needs a name.',
            'offered.*.name.max' => 'A course name can have at most ' . SchoolCourseService::MAX_NAME_LENGTH . ' characters.',
            'offered.*.name.regex' => "A course name can only have letters, numbers, spaces and . , & ( ) - '",
            'offered.*.required_hours.integer' => 'Required hours must be a whole number.',
            'offered.*.required_hours.min' => 'Required hours must be at least ' . SchoolCourseService::MIN_HOURS . '.',
            'offered.*.required_hours.max' => 'Required hours can be at most ' . SchoolCourseService::MAX_HOURS . '.',
        ]);

        $items = [];
        $seen = [];
        foreach ($data['offered'] as $row) {
            $name = Courses::canonical($row['name']);
            if ($name === null || $name === '') {
                throw ValidationException::withMessages(['offered' => 'A course needs a name.']);
            }
            if (mb_strlen($name) > SchoolCourseService::MAX_NAME_LENGTH) {
                throw ValidationException::withMessages(['offered' => 'A course name can have at most ' . SchoolCourseService::MAX_NAME_LENGTH . ' characters.']);
            }
            $key = SchoolCourseService::key($name);
            if (isset($seen[$key])) {
                throw ValidationException::withMessages(['offered' => "\"{$name}\" is listed twice."]);
            }
            $seen[$key] = true;
            $items[] = ['name' => $name, 'required_hours' => isset($row['required_hours']) ? (int) $row['required_hours'] : null];
        }

        [$added, $removed, $internsUpdated] = SchoolCourseService::replace($schoolId, $items);

        $parts = [];
        if ($added) {
            $parts[] = 'added ' . implode(', ', $added);
        }
        if ($removed) {
            $parts[] = 'removed ' . implode(', ', $removed);
        }
        if ($internsUpdated) {
            $parts[] = "required hours updated for {$internsUpdated} intern" . ($internsUpdated === 1 ? '' : 's');
        }
        ActivityLogService::record(
            module: 'Settings',
            action: 'Updated courses offered',
            description: 'Courses offered: ' . count($items) . ' course' . (count($items) === 1 ? '' : 's') . ($parts ? ' (' . implode('; ', $parts) . ')' : ', hours updated') . '.',
            schoolId: $schoolId,
            request: $request
        );

        return response()->json(SchoolCourseService::payload($schoolId) + ['message' => 'Courses offered saved.', 'interns_updated' => $internsUpdated]);
    }
}
