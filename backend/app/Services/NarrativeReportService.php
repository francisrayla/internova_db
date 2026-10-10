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

        // The sections that are documents follow what the intern's course requires (see
        // CourseRequirementService::applyToSections): a type that is not required and has no upload is left out.
        $allDocs = Document::where('deployment_id', $d->id)->orderByDesc('id')->get();
        $template['sections'] = CourseRequirementService::applyToSections(
            $template['sections'],
            CourseRequirementService::forSchool($school)->typesFor($profile?->course),
            $allDocs->map(fn (Document $x) => CourseRequirementService::norm($x->document_type))->unique()->values()->all()
        );

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
        // The intern's one evaluation (the official one if older data holds several).
        $evaluation = Evaluation::officialQuery($d->id)->with(['evaluator', 'scores.criterion'])->first();

        $disk = Storage::disk('public');
        $url = fn (?string $path) => $path ? $disk->url($path) : null;

        // Daily Time Record: one line per day. A single-session day shows its time in and out;
        // a split day shows the morning and the afternoon. Only complete, approved punches count.
        $fmt = fn ($t) => $t?->local()?->format('h:i A');
        $running = 0.0;
        $ledger = [];
        $split = false;
        foreach ($approved->groupBy(fn ($a) => $a->attendance_date?->toDateString()) as $day => $rows) {
            $done = $rows->filter(fn ($a) => $a->clock_in && $a->clock_out);
            if (!$day || $done->isEmpty()) {
                continue;
            }
            $hours = round($done->sum(fn ($a) => $a->workedMinutes()) / 60, 2);
            $running += $hours;
            $am = $rows->firstWhere('session', Attendance::AM);
            $pm = $rows->firstWhere('session', Attendance::PM);
            $full = $rows->firstWhere('session', Attendance::FULL);
            $split = $split || $am || $pm;
            $ledger[] = [
                'date' => $rows->first()->attendance_date?->format('M d, Y'),
                // A full day's single in/out sits in the first "in" and the last "out" column.
                'am_in' => $fmt($am?->clock_in ?? $full?->clock_in),
                'am_out' => $fmt($am?->clock_out),
                'pm_in' => $fmt($pm?->clock_in),
                'pm_out' => $fmt($pm?->clock_out ?? $full?->clock_out),
                'time_in' => $fmt($rows->pluck('clock_in')->filter()->sort()->first()),
                'time_out' => $fmt($rows->pluck('clock_out')->filter()->sort()->last()),
                'hours' => $hours,
                'running_total' => round($running, 2),
                'company' => $companyOn($day),
            ];
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
        // reportable narrative. AM = the day's first time in, PM = its last time out.
        $days = [];
        foreach ($approved as $a) {
            $key = $a->attendance_date?->toDateString();
            if ($key) {
                $days[$key]['date'] = $a->attendance_date;
                $in = $a->clock_in?->local();
                $out = $a->clock_out?->local();
                if ($in && (!isset($days[$key]['in']) || $in->lt($days[$key]['in']))) {
                    $days[$key]['in'] = $in;
                }
                if ($out && (!isset($days[$key]['out']) || $out->gt($days[$key]['out']))) {
                    $days[$key]['out'] = $out;
                }
                $days[$key]['am'] = isset($days[$key]['in']) ? $days[$key]['in']->format('h:i A') : null;
                $days[$key]['pm'] = isset($days[$key]['out']) ? $days[$key]['out']->format('h:i A') : null;
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
            'ledger' => ['multi_company' => $multi, 'split' => $split, 'rows' => $ledger, 'total_hours' => round($running, 2), 'required_hours' => $d->required_hours],
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
            'documents' => self::matchDocuments($allDocs, $template['sections']),
            'texts' => $portfolio?->report_texts ?? (object) [],
        ];
    }

    /**
     * Document per `document` section, keyed by section key: type matched
     * case-insensitively (trimmed, inner spaces collapsed), approved preferred, otherwise the latest upload.
     */
    private static function matchDocuments($docs, array $sections): array
    {
        $out = [];
        foreach ($sections as $s) {
            if (($s['source'] ?? null) !== 'document') {
                continue;
            }
            $type = CourseRequirementService::norm($s['document_type'] ?? $s['title']);
            $matches = $docs->filter(fn (Document $x) => CourseRequirementService::norm($x->document_type) === $type);
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
