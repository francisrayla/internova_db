<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\CertificateTemplate;
use App\Models\Company;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\SupervisorProfile;
use App\Services\ActivityLogService;
use App\Services\CertificateService;
use App\Support\LocalTime;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * The OJT certificate of completion. A supervisor uploads a PowerPoint template once
 * (shared by every supervisor of the company), then types or confirms an intern's name
 * and gets a filled-in PowerPoint to print or edit.
 */
class SupervisorCertificateController extends Controller
{
    private const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

    private function company(Request $request): ?Company
    {
        return SupervisorProfile::with('company')->where('user_id', $request->user()->id)->first()?->company;
    }

    private function fullName($user): string
    {
        return trim("{$user?->first_name} {$user?->last_name}") ?: (string) $user?->name;
    }

    private function hoursByDeployment(array $ids): array
    {
        return Attendance::whereIn('deployment_id', $ids)->where('status', 'approved')
            ->get(['deployment_id', 'clock_in', 'clock_out'])
            ->groupBy('deployment_id')
            ->map(fn ($rows) => round($rows->sum(fn (Attendance $a) => $a->workedMinutes()) / 60, 1))
            ->all();
    }

    /** The template (or null), the markers it understands, and the interns a certificate can be made for. */
    public function show(Request $request): JsonResponse
    {
        $company = $this->company($request);
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Supervisor profile not found.'], 404);
        }

        $template = CertificateTemplate::with('uploader')->where('company_id', $company->id)->first();
        $path = $template ? Storage::disk('public')->path($template->file_path) : null;
        $markers = $path && is_file($path) ? CertificateService::markersIn($path) : [];

        $deployments = InternshipDeployment::with(['intern', 'company'])->visibleToSupervisor($request->user())
            ->whereIn('status', ['active', 'completed'])->get();
        $hours = $this->hoursByDeployment($deployments->pluck('id')->all());
        $profiles = InternProfile::whereIn('user_id', $deployments->pluck('intern_id'))->get()->keyBy('user_id');
        $name = $this->fullName($request->user());

        return response()->json([
            'success' => true,
            'template' => $template ? [
                'name' => $template->original_name,
                'uploaded_at' => $template->updated_at?->local()?->format('M d, Y'),
                'uploaded_by' => $template->uploader ? $this->fullName($template->uploader) : null,
                'markers' => $markers,
            ] : null,
            'placeholders' => collect(CertificateService::PLACEHOLDERS)->map(fn ($desc, $key) => ['key' => $key, 'token' => '{{' . $key . '}}', 'description' => $desc])->values(),
            'interns' => $deployments->map(fn (InternshipDeployment $d) => [
                'deployment_id' => $d->id,
                'name' => $this->fullName($d->intern),
                'course' => $profiles->get($d->intern_id)?->course,
                'status' => $d->status,
                'hours' => $hours[$d->id] ?? 0,
                'required_hours' => (int) $d->required_hours,
                'start_date' => $d->start_date?->toDateString(),
                'end_date' => $d->end_date?->toDateString(),
            ])->sortBy('name')->values(),
            'company_name' => $company->company_name,
            'supervisor_name' => $name,
            'today' => LocalTime::today(),
        ]);
    }

    public function upload(Request $request): JsonResponse
    {
        $company = $this->company($request);
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Supervisor profile not found.'], 404);
        }

        $request->validate(['template' => 'required|file|max:10240']);
        $file = $request->file('template');
        if (strtolower($file->getClientOriginalExtension()) !== 'pptx' || !CertificateService::isPresentation($file->getRealPath())) {
            return response()->json(['success' => false, 'message' => 'Please upload a PowerPoint (.pptx) file.'], 422);
        }
        if (!in_array('NAME', CertificateService::markersIn($file->getRealPath()), true)) {
            return response()->json(['success' => false, 'message' => 'Type {{NAME}} on the slide where the intern\'s name should appear, then upload it again.'], 422);
        }

        $existing = CertificateTemplate::where('company_id', $company->id)->first();
        $path = $file->store("certificate-templates/{$company->id}", 'public');
        if ($existing) {
            Storage::disk('public')->delete($existing->file_path);
            $existing->update(['file_path' => $path, 'original_name' => $file->getClientOriginalName(), 'uploaded_by' => $request->user()->id]);
        } else {
            CertificateTemplate::create(['company_id' => $company->id, 'uploaded_by' => $request->user()->id, 'file_path' => $path, 'original_name' => $file->getClientOriginalName()]);
        }

        ActivityLogService::record(module: 'Certificates', action: 'Uploaded certificate template', description: "{$company->company_name}: {$file->getClientOriginalName()}.", schoolId: $company->school_id, request: $request);

        return response()->json(['success' => true, 'message' => 'Template saved.']);
    }

    public function destroy(Request $request): JsonResponse
    {
        $company = $this->company($request);
        $template = $company ? CertificateTemplate::where('company_id', $company->id)->first() : null;
        if (!$template) {
            return response()->json(['success' => false, 'message' => 'There is no template to remove.'], 404);
        }
        Storage::disk('public')->delete($template->file_path);
        $template->delete();

        return response()->json(['success' => true, 'message' => 'Template removed.']);
    }

    /** A ready-made example the supervisor can open in PowerPoint and restyle. */
    public function sample(): BinaryFileResponse
    {
        return response()->download(resource_path('certificate/sample-certificate-template.pptx'), 'Sample certificate template.pptx', ['Content-Type' => self::PPTX]);
    }

    public function generate(Request $request): BinaryFileResponse|JsonResponse
    {
        $company = $this->company($request);
        $data = $request->validate([
            'deployment_id' => 'required|integer',
            'name' => 'required|string|max:120',
            'uppercase' => 'nullable|boolean',
            'hours' => 'nullable|numeric|min:0|max:5000',
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'date_issued' => 'nullable|date',
            'signatory' => 'nullable|string|max:120',
        ]);

        $deployment = InternshipDeployment::with(['intern', 'school'])->visibleToSupervisor($request->user())->find($data['deployment_id']);
        if (!$company || !$deployment) {
            return response()->json(['success' => false, 'message' => 'This intern is not at your company.'], 404);
        }
        $template = CertificateTemplate::where('company_id', $company->id)->first();
        $templatePath = $template ? Storage::disk('public')->path($template->file_path) : null;
        if (!$templatePath || !is_file($templatePath)) {
            return response()->json(['success' => false, 'message' => 'Upload a certificate template first.'], 422);
        }

        $profile = InternProfile::where('user_id', $deployment->intern_id)->first();
        $date = fn (?string $d) => $d ? Carbon::parse($d)->format('F j, Y') : '';
        $hours = $data['hours'] ?? ($this->hoursByDeployment([$deployment->id])[$deployment->id] ?? 0);
        $name = trim($data['name']);

        $file = CertificateService::fill($templatePath, [
            'NAME' => !empty($data['uppercase']) ? mb_strtoupper($name) : $name,
            'COURSE' => (string) $profile?->course,
            'HOURS' => rtrim(rtrim(number_format((float) $hours, 1, '.', ''), '0'), '.'),
            'COMPANY' => (string) $company->company_name,
            'SCHOOL' => (string) $deployment->school?->school_name,
            'START_DATE' => $date($data['start_date'] ?? $deployment->start_date?->toDateString()),
            'END_DATE' => $date($data['end_date'] ?? $deployment->end_date?->toDateString()),
            'DATE' => $date($data['date_issued'] ?? LocalTime::today()),
            'SUPERVISOR' => trim($data['signatory'] ?? '') ?: $this->fullName($request->user()),
        ]);

        ActivityLogService::record(module: 'Certificates', action: 'Generated certificate', description: "Certificate of completion for {$name} ({$company->company_name}).", schoolId: $company->school_id, request: $request);

        return response()->download($file, 'Certificate of Completion - ' . Str::of($name)->replaceMatches('/[^\pL\pN\s\-\.]/u', '')->trim() . '.pptx', ['Content-Type' => self::PPTX])->deleteFileAfterSend(true);
    }
}
