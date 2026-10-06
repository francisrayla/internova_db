<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\DailyActivity;
use App\Models\Document;
use App\Models\Evaluation;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\Portfolio;
use App\Models\Task;
use Illuminate\Support\Facades\Storage;

/**
 * Everything the printable narrative report needs for one deployment, in one
 * payload: the school's resolved template plus the data behind every section
 * source. Shared by the intern's own endpoint and the coordinator's view of
 * one of their interns, so both always print the same document.
 */
class NarrativeReportService
{
    private const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

    public static function build(InternshipDeployment $d): array
    {
        $d->loadMissing(['intern', 'company.activeSupervisorProfiles.user', 'school']);
        $school = $d->school;
        $profile = InternProfile::where('user_id', $d->intern_id)->where('school_id', $d->school_id)->first();
        $summary = DeploymentSummaryService::summarize($d, $profile);
        $studentName = $summary['intern_name'];
        $companyName = $d->company?->company_name;

        // Transfer history (empty when never reassigned): the company in effect on each date.
        $segments = DeploymentHistoryService::segments($d);
        $multi = count($segments) > 1;
        $companyOn = fn (?string $day) => $multi ? DeploymentHistoryService::companyOn($segments, $day) : null;

        $template = NarrativeTemplateService::resolve($school, $d->start_date, [
            'company_name' => $companyName,
            'student_name' => $studentName,
        ]);

        $approved = Attendance::where('deployment_id', $d->id)
            ->where('status', 'approved')
            ->orderBy('attendance_date')
            ->orderBy('id')
            ->get();

        $activities = DailyActivity::where('deployment_id', $d->id)
            ->whereIn('status', DailyActivity::IN_REPORT)
            ->orderBy('activity_date')
            ->orderBy('id')
            ->get();

        $tasks = Task::with('proofs')
            ->whereHas('assignees', fn ($q) => $q->where('deployment_id', $d->id))
            ->orderBy('id')
            ->get();

        $portfolio = Portfolio::with('items')->where('intern_id', $d->intern_id)->first();
        $evaluation = Evaluation::with(['evaluator', 'scores.criterion'])
            ->where('deployment_id', $d->id)
            ->latest('evaluation_date')
            ->latest('id')
            ->first();

        $disk = Storage::disk('public');
        $url = fn (?string $path) => $path ? $disk->url($path) : null;

        // Ledger: only complete, approved days count toward the hours.
        $running = 0.0;
        $ledger = [];
        foreach ($approved as $a) {
            if (!$a->clock_in || !$a->clock_out) {
                continue;
            }
            $hours = round(max(0, $a->clock_in->diffInMinutes($a->clock_out)) / 60, 2);
            $running += $hours;
            $ledger[] = [
                'date' => $a->attendance_date?->format('M d, Y'),
                'time_in' => $a->clock_in->local()->format('h:i A'),
                'time_out' => $a->clock_out->local()->format('h:i A'),
                'hours' => $hours,
                'running_total' => round($running, 2),
                'company' => $companyOn($a->attendance_date?->toDateString()),
            ];
        }

        $attendancePhotos = [];
        foreach ($approved as $a) {
            $date = $a->attendance_date?->format('M d, Y');
            if ($a->clock_in_selfie_path) {
                $attendancePhotos[] = ['url' => $url($a->clock_in_selfie_path), 'date' => $date, 'time' => $a->clock_in?->local()?->format('h:i A'), 'kind' => 'Time in'];
            }
            if ($a->clock_out_selfie_path) {
                $attendancePhotos[] = ['url' => $url($a->clock_out_selfie_path), 'date' => $date, 'time' => $a->clock_out?->local()?->format('h:i A'), 'kind' => 'Time out'];
            }
        }

        $taskRows = [];
        $taskPhotos = [];
        foreach ($tasks as $t) {
            $taskRows[] = ['id' => $t->id, 'title' => $t->title, 'description' => $t->description, 'status' => $t->status];
            foreach ($t->proofs as $p) {
                if (self::isImage($p->file_path, $p->mime_type)) {
                    $taskPhotos[] = ['url' => $url($p->file_path), 'caption' => $t->title];
                }
            }
        }

        // Journal: one row per day that has either an approved attendance or a
        // reportable narrative. AM = time in, PM = time out (attendance keeps a
        // single in/out per day, not a morning/afternoon split).
        $days = [];
        foreach ($approved as $a) {
            $key = $a->attendance_date?->toDateString();
            if ($key) {
                $days[$key]['date'] = $a->attendance_date;
                $days[$key]['am'] = $a->clock_in?->local()?->format('h:i A');
                $days[$key]['pm'] = $a->clock_out?->local()?->format('h:i A');
                $days[$key]['company'] = $companyOn($key);
            }
        }
        foreach ($activities as $act) {
            $key = $act->activity_date?->toDateString();
            if ($key) {
                $days[$key]['date'] = $act->activity_date;
                $days[$key]['entries'][] = trim($act->description ?: $act->title);
                $days[$key]['company'] ??= $companyOn($key);
            }
        }
        ksort($days);
        $journal = array_values(array_map(fn ($row) => [
            'date' => $row['date']->format('M d, Y'),
            'day' => $row['date']->format('l'),
            'am' => $row['am'] ?? null,
            'pm' => $row['pm'] ?? null,
            'schedule' => implode("\n\n", array_filter($row['entries'] ?? [])),
            'company' => $row['company'] ?? null,
        ], $days));

        return [
            'template' => $template,
            'student' => [
                'name' => $studentName,
                'student_number' => $profile?->student_number,
                'course' => $profile?->course,
                'year_level' => $profile?->year_level,
            ],
            'school' => ['name' => $school->school_name, 'address' => $school->address],
            'company' => ['name' => $companyName, 'address' => $d->company?->address],
            // No office/department is recorded on a deployment yet.
            'department' => null,
            'coordinator' => ['name' => $template['cover']['submitted_to_name'], 'title' => $template['cover']['submitted_to_title']],
            'supervisor_name' => $summary['supervisor_name'],
            'deployment' => [
                'id' => $d->id,
                'start_date' => $summary['start_date'],
                'end_date' => $summary['end_date'],
                'required_hours' => $summary['required_hours'],
                'hours_completed' => $summary['hours_completed'],
                // Earlier placements, for one line on the title page: "Previously deployed at X, Apr 20 – Oct 19, 2026".
                'previous' => collect($segments)->reject(fn ($x) => $x['is_current'])->map(fn ($x) => [
                    'company_name' => $x['company_name'],
                    'range' => $x['range'],
                    'hours' => $x['hours'],
                    'label' => "Previously deployed at {$x['company_name']}" . ($x['range'] ? ", {$x['range']}" : ''),
                ])->values()->all(),
            ],
            'ledger' => ['multi_company' => $multi, 'rows' => $ledger, 'total_hours' => round($running, 2), 'required_hours' => $d->required_hours],
            'attendance_photos' => $attendancePhotos,
            'duties' => ['intro' => NarrativeTemplateService::DUTIES_INTRO, 'tasks' => $taskRows],
            'task_photos' => $taskPhotos,
            'journal' => $journal,
            'work_samples' => ($portfolio?->items ?? collect())->map(fn ($i) => [
                'id' => $i->id,
                'title' => $i->title,
                'description' => $i->description,
                'image_url' => $url($i->image_path),
                'project_url' => $i->project_url,
            ])->values(),
            'evaluation' => $evaluation ? self::mapEvaluation($evaluation) : null,
            'documents' => self::matchDocuments($d->id, $template['sections']),
            'texts' => $portfolio?->report_texts ?? (object) [],
        ];
    }

    /**
     * Document per `document` section, keyed by section key: type matched
     * case-insensitively, approved preferred, otherwise the latest upload.
     */
    private static function matchDocuments(int $deploymentId, array $sections): array
    {
        $docs = Document::where('deployment_id', $deploymentId)->orderByDesc('id')->get();
        $out = [];
        foreach ($sections as $s) {
            if (($s['source'] ?? null) !== 'document') {
                continue;
            }
            $type = mb_strtolower(trim($s['document_type'] ?? $s['title']));
            $matches = $docs->filter(fn (Document $x) => mb_strtolower(trim($x->document_type)) === $type);
            $doc = $matches->firstWhere('status', 'approved') ?? $matches->first();
            $out[$s['key']] = $doc ? [
                'id' => $doc->id,
                'document_type' => $doc->document_type,
                'file_name' => $doc->file_name,
                'file_url' => Storage::disk('public')->url($doc->file_path),
                'is_image' => self::isImage($doc->file_path),
                'status' => $doc->status,
            ] : null;
        }

        return $out;
    }

    private static function isImage(?string $path, ?string $mime = null): bool
    {
        if ($mime && str_starts_with($mime, 'image/')) {
            return true;
        }

        return in_array(strtolower(pathinfo((string) $path, PATHINFO_EXTENSION)), self::IMAGE_EXTENSIONS, true);
    }

    private static function mapEvaluation(Evaluation $e): array
    {
        return [
            'evaluator_name' => $e->evaluator?->name,
            'evaluation_type' => $e->evaluation_type,
            'evaluation_date' => $e->evaluation_date?->format('M d, Y'),
            'overall_score' => $e->overall_score,
            'remarks' => $e->remarks,
            'category_comments' => $e->category_comments ?? [],
            'scores' => $e->scores->map(fn ($s) => [
                'category' => $s->criterion?->category,
                'criterion_name' => $s->criterion?->name,
                'score' => $s->score,
                'max_score' => $s->criterion?->max_score,
                'remarks' => $s->remarks,
            ])->values(),
        ];
    }
}
