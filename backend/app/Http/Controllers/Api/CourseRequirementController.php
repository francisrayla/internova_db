<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InternshipDeployment;
use App\Models\School;
use App\Services\ActivityLogService;
use App\Services\CourseRequirementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Which documents each course must submit. The coordinator edits their own
 * school's sets (always scoped by the signed-in user's school_id); interns and
 * the coordinator's upload screen read the set that applies to one intern.
 * Nothing here deletes an uploaded Document.
 */
class CourseRequirementController extends Controller
{
    private function service(Request $request): CourseRequirementService
    {
        return CourseRequirementService::forSchool(School::findOrFail($request->user()->school_id));
    }

    private function payload(CourseRequirementService $svc): array
    {
        return [
            'success' => true,
            'courses' => $svc->courses(),
            'choices' => $svc->choices(),
            'default' => $svc->defaultTypes(),
            'max_requirements' => CourseRequirementService::MAX_REQUIREMENTS,
            'max_name_length' => CourseRequirementService::MAX_NAME_LENGTH,
        ];
    }

    private function log(Request $request, string $action, string $description): void
    {
        ActivityLogService::record(module: 'Documents', action: $action, description: $description, schoolId: $request->user()->school_id, request: $request);
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->payload($this->service($request)));
    }

    /** Replace one course's requirements with the ticked list (ordered). */
    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'course' => 'required|string|max:150',
            'requirements' => 'present|array|max:' . CourseRequirementService::MAX_REQUIREMENTS,
            'requirements.*' => 'required|string|max:' . CourseRequirementService::MAX_NAME_LENGTH,
        ], [
            'requirements.max' => 'A course can have at most ' . CourseRequirementService::MAX_REQUIREMENTS . ' requirements.',
            'requirements.*.max' => 'A requirement name can have at most ' . CourseRequirementService::MAX_NAME_LENGTH . ' characters.',
            'requirements.*.required' => 'A requirement name cannot be empty.',
        ]);

        $svc = $this->service($request);
        $course = $svc->canonicalCourse($data['course']);
        if ($course === null) {
            return response()->json(['success' => false, 'message' => 'That course was not found for your school.'], 422);
        }

        $types = [];
        $seen = [];
        foreach ($data['requirements'] as $name) {
            $tidy = CourseRequirementService::tidy($name);
            $key = CourseRequirementService::norm($tidy);
            if ($key === '') {
                return response()->json(['success' => false, 'message' => 'A requirement name cannot be empty.', 'errors' => ['requirements' => ['A requirement name cannot be empty.']]], 422);
            }
            if ($key === 'other') {
                return response()->json(['success' => false, 'message' => '"Other" cannot be used as a requirement name.', 'errors' => ['requirements' => ['"Other" cannot be used as a requirement name.']]], 422);
            }
            if (isset($seen[$key])) {
                return response()->json(['success' => false, 'message' => "\"{$tidy}\" is listed twice.", 'errors' => ['requirements' => ["\"{$tidy}\" is listed twice."]]], 422);
            }
            $seen[$key] = true;
            $types[] = $svc->canonicalType($tidy);
        }

        $svc->save($course, $types);
        $this->log($request, 'Updated course requirements', "Requirements for {$course} were set to " . (count($types) ? implode(', ', $types) : 'none') . '.');

        return response()->json($this->payload($this->service($request)) + ['message' => "Requirements for {$course} saved."]);
    }

    /** Back to the system default for one course. */
    public function reset(Request $request): JsonResponse
    {
        $data = $request->validate(['course' => 'required|string|max:150']);

        $svc = $this->service($request);
        $course = $svc->canonicalCourse($data['course']);
        if ($course === null) {
            return response()->json(['success' => false, 'message' => 'That course was not found for your school.'], 422);
        }

        $svc->reset($course);
        $this->log($request, 'Reset course requirements', "Requirements for {$course} were reset to the default.");

        return response()->json($this->payload($this->service($request)) + ['message' => "{$course} uses the default requirements again."]);
    }

    /** Rename a custom requirement in every course of the school; uploads under the old name follow. */
    public function rename(Request $request): JsonResponse
    {
        $max = CourseRequirementService::MAX_NAME_LENGTH;
        $data = $request->validate([
            'from' => 'required|string|max:' . $max,
            'to' => 'required|string|max:' . $max,
        ], ['to.max' => "A requirement name can have at most {$max} characters."]);

        $svc = $this->service($request);
        $from = CourseRequirementService::tidy($data['from']);
        $to = CourseRequirementService::tidy($data['to']);
        $fromKey = CourseRequirementService::norm($from);
        $toKey = CourseRequirementService::norm($to);

        $isKnownCustom = collect($svc->customTypes())->contains(fn ($t) => CourseRequirementService::norm($t) === $fromKey);
        if ($svc->isBuiltin($from) || !$isKnownCustom) {
            return response()->json(['success' => false, 'message' => 'Only the custom requirements you added can be renamed.'], 422);
        }
        if ($toKey === '' || $toKey === 'other') {
            return response()->json(['success' => false, 'message' => 'Enter a name for the requirement.'], 422);
        }
        $clash = $toKey !== $fromKey && collect($svc->choices())->contains(fn ($c) => CourseRequirementService::norm($c['name']) === $toKey);
        if ($clash) {
            return response()->json(['success' => false, 'message' => "\"{$to}\" already exists."], 422);
        }

        $moved = $svc->rename($from, $to);
        $this->log($request, 'Renamed a requirement', "The requirement \"{$from}\" was renamed to \"{$to}\" ({$moved} uploaded " . ($moved === 1 ? 'document follows' : 'documents follow') . ' the new name).');

        return response()->json($this->payload($this->service($request)) + ['message' => "Renamed to {$to}."]);
    }

    /** Coordinator upload screen: the types for one intern of their school. */
    public function forDeployment(Request $request): JsonResponse
    {
        $data = $request->validate(['deployment_id' => 'required|integer']);
        $deployment = InternshipDeployment::where('id', $data['deployment_id'])->where('school_id', $request->user()->school_id)->first();
        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'Intern not found for your school.'], 404);
        }

        return response()->json(['success' => true] + $this->service($request)->payloadFor($deployment));
    }

    /** The signed-in intern's own list (current deployment, else the most recent). */
    public function forIntern(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deployment = InternshipDeployment::where('intern_id', $internId)->where('status', 'active')->latest('start_date')->first()
            ?? InternshipDeployment::where('intern_id', $internId)->latest('start_date')->first();
        $svc = $this->service($request);

        if (!$deployment) {
            return response()->json([
                'success' => true,
                'course' => null,
                'is_default' => true,
                'requirements' => [],
                'others' => array_map(fn ($c) => $c['name'], $svc->choices()),
            ]);
        }

        return response()->json(['success' => true] + $svc->payloadFor($deployment));
    }
}
