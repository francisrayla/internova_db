<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InternshipDeployment;
use App\Models\NarrativeTemplate;
use App\Models\School;
use App\Services\NarrativeDocxService;
use App\Services\NarrativeReportService;
use App\Services\NarrativeTemplateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Printable narrative report (school pattern): the coordinator edits the
 * school's template (letterhead, cover, logo), and the intern — or their
 * coordinator — fetches the resolved template plus all data to render it.
 */
class NarrativeReportController extends Controller
{
    private function templatePayload(Request $request): array
    {
        $school = School::findOrFail($request->user()->school_id);
        $resolved = NarrativeTemplateService::resolve($school);

        return [
            'is_default' => $resolved['is_default'],
            'logo_url' => $resolved['logo_url'],
            'letterhead' => $resolved['letterhead'],
            'cover' => $resolved['cover'],
        ];
    }

    public function showTemplate(Request $request): JsonResponse
    {
        return response()->json(['success' => true, 'template' => $this->templatePayload($request)]);
    }

    // Phase 1 edits letterhead + cover only; sections stay on the default.
    public function updateTemplate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'letterhead' => 'sometimes|array',
            'letterhead.school_name' => 'nullable|string|max:255',
            'letterhead.address' => 'nullable|string|max:500',
            'letterhead.contact' => 'nullable|string|max:255',
            'letterhead.website' => 'nullable|string|max:255',
            'cover' => 'sometimes|array',
            'cover.department' => 'nullable|string|max:255',
            'cover.program_text' => 'nullable|string|max:500',
            'cover.submitted_to_name' => 'nullable|string|max:255',
            'cover.submitted_to_title' => 'nullable|string|max:255',
            'cover.school_year' => 'nullable|string|max:20',
        ]);

        $row = NarrativeTemplate::firstOrNew(['school_id' => $request->user()->school_id]);
        foreach (['letterhead' => NarrativeTemplateService::LETTERHEAD_FIELDS, 'cover' => NarrativeTemplateService::COVER_FIELDS] as $group => $fields) {
            if (!array_key_exists($group, $data)) {
                continue;
            }
            $current = $row->{$group} ?? [];
            foreach ($fields as $f) {
                if (array_key_exists($f, $data[$group])) {
                    $v = $data[$group][$f];
                    $current[$f] = is_string($v) && trim($v) !== '' ? trim($v) : null;
                }
            }
            $row->{$group} = $current;
        }
        $row->save();

        return response()->json(['success' => true, 'template' => $this->templatePayload($request)]);
    }

    public function uploadLogo(Request $request): JsonResponse
    {
        $request->validate(['logo' => 'required|image|mimes:jpg,jpeg,png,webp|max:2048']);

        $schoolId = $request->user()->school_id;
        $row = NarrativeTemplate::firstOrNew(['school_id' => $schoolId]);
        $old = $row->logo_path;
        $row->logo_path = $request->file('logo')->store("narrative/{$schoolId}", 'public');
        $row->save();
        if ($old) {
            Storage::disk('public')->delete($old);
        }

        return response()->json(['success' => true, 'template' => $this->templatePayload($request)]);
    }

    public function destroyLogo(Request $request): JsonResponse
    {
        $row = NarrativeTemplateService::rowFor($request->user()->school_id);
        if ($row?->logo_path) {
            Storage::disk('public')->delete($row->logo_path);
            $row->update(['logo_path' => null]);
        }

        return response()->json(['success' => true, 'template' => $this->templatePayload($request)]);
    }

    /** The intern's own report — current deployment (active, else most recent). */
    public function internReport(Request $request): JsonResponse
    {
        $internId = $request->user()->id;
        $deployment = InternshipDeployment::where('intern_id', $internId)->where('status', 'active')->latest('start_date')->first()
            ?? InternshipDeployment::where('intern_id', $internId)->latest('start_date')->first();

        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'You need a deployment to generate a report.'], 422);
        }

        return response()->json(NarrativeReportService::build($deployment));
    }

    /** A coordinator opening the report of one of their own school's interns. */
    public function coordinatorReport(Request $request, int $deploymentId): JsonResponse
    {
        $deployment = InternshipDeployment::where('id', $deploymentId)
            ->where('school_id', $request->user()->school_id)
            ->first();

        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'Intern not found.'], 404);
        }

        return response()->json(NarrativeReportService::build($deployment));
    }

    /** Word (.docx) download of the intern's own report. */
    public function internDocx(Request $request): JsonResponse|BinaryFileResponse
    {
        $internId = $request->user()->id;
        $deployment = InternshipDeployment::where('intern_id', $internId)->where('status', 'active')->latest('start_date')->first()
            ?? InternshipDeployment::where('intern_id', $internId)->latest('start_date')->first();

        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'You need a deployment to generate a report.'], 422);
        }

        return $this->docxResponse($deployment);
    }

    /** Word (.docx) download for one of the coordinator's own school's interns. */
    public function coordinatorDocx(Request $request, int $deploymentId): JsonResponse|BinaryFileResponse
    {
        $deployment = InternshipDeployment::where('id', $deploymentId)
            ->where('school_id', $request->user()->school_id)
            ->first();

        if (!$deployment) {
            return response()->json(['success' => false, 'message' => 'Intern not found.'], 404);
        }

        return $this->docxResponse($deployment);
    }

    private function docxResponse(InternshipDeployment $deployment): BinaryFileResponse
    {
        // Many embedded photos: give image resizing and zipping room to work.
        @set_time_limit(180);
        @ini_set('memory_limit', '768M');

        $data = NarrativeReportService::build($deployment);
        $path = NarrativeDocxService::build($data);
        $name = 'Narrative_Report_' . (trim(preg_replace('/[^A-Za-z0-9]+/', '_', $data['student']['name'] ?? ''), '_') ?: 'Student') . '.docx';

        return response()->download($path, $name, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ])->deleteFileAfterSend(true);
    }
}
