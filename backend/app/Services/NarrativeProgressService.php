<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\DailyActivity;
use App\Models\Document;
use App\Models\Evaluation;
use App\Models\InternshipDeployment;
use App\Models\Portfolio;
use App\Models\School;
use App\Models\TaskProof;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * "x of N requirements complete" for many deployments at once, with the same
 * rules as the frontend NarrativeChecklist (which works from the full report
 * payload for one intern). Batched: a fixed number of queries no matter how
 * many interns, so the Dean's lists never run a query per intern.
 */
class NarrativeProgressService
{
    private const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

    /**
     * @param  Collection<int, InternshipDeployment>  $deployments  all from one school
     * @return array<int, array{done:int,total:int,missing_documents:int}>  keyed by deployment id
     */
    public static function forDeployments(School $school, Collection $deployments): array
    {
        if ($deployments->isEmpty()) {
            return [];
        }

        $ids = $deployments->pluck('id')->all();
        $internIds = $deployments->pluck('intern_id')->unique()->all();
        $sections = collect(NarrativeTemplateService::resolve($school)['sections'])
            // Fixed text / blank pages need nothing from the intern.
            ->filter(fn ($s) => in_array($s['source'] ?? null, ['document', 'intern_text', 'auto_ledger', 'auto_attendance', 'auto_duties', 'auto_photos', 'auto_work_samples', 'auto_journal', 'auto_evaluation'], true))
            ->values();

        $attendance = Attendance::whereIn('deployment_id', $ids)->where('status', 'approved')
            ->get(['deployment_id', 'attendance_date', 'clock_in', 'clock_out', 'clock_in_selfie_path', 'clock_out_selfie_path'])
            ->groupBy('deployment_id');
        $activityDays = DailyActivity::whereIn('deployment_id', $ids)->whereIn('status', DailyActivity::IN_REPORT)
            ->get(['deployment_id'])->countBy('deployment_id');
        $taskCounts = DB::table('task_assignees')->whereIn('deployment_id', $ids)
            ->selectRaw('deployment_id, count(distinct task_id) as n')->groupBy('deployment_id')->pluck('n', 'deployment_id');
        $photoRows = TaskProof::query()
            ->join('task_assignees', 'task_assignees.task_id', '=', 'task_proofs.task_id')
            ->whereIn('task_assignees.deployment_id', $ids)
            ->get(['task_assignees.deployment_id as dep', 'task_proofs.file_path', 'task_proofs.mime_type']);
        $photos = [];
        foreach ($photoRows as $row) {
            if (self::isImage($row->file_path, $row->mime_type)) {
                $photos[$row->dep] = ($photos[$row->dep] ?? 0) + 1;
            }
        }
        $documents = Document::whereIn('deployment_id', $ids)->get(['deployment_id', 'document_type'])->groupBy('deployment_id');
        $portfolios = Portfolio::whereIn('intern_id', $internIds)->withCount('items')->get()->keyBy('intern_id');
        $evaluated = Evaluation::whereIn('deployment_id', $ids)->distinct()->pluck('deployment_id')->flip();

        $out = [];
        foreach ($deployments as $d) {
            $rows = $attendance->get($d->id, collect());
            $hours = $rows->filter(fn ($a) => $a->clock_in && $a->clock_out)
                ->sum(fn ($a) => max(0, $a->clock_in->diffInMinutes($a->clock_out)) / 60);
            $types = $documents->get($d->id, collect())->map(fn ($x) => mb_strtolower(trim($x->document_type)))->all();
            $portfolio = $portfolios->get($d->intern_id);
            $texts = $portfolio?->report_texts ?? [];

            $done = 0;
            $missingDocs = 0;
            foreach ($sections as $s) {
                $ok = match ($s['source']) {
                    'document' => in_array(mb_strtolower(trim($s['document_type'] ?? $s['title'])), $types, true),
                    'intern_text' => trim((string) ($texts[$s['key']] ?? '')) !== '',
                    'auto_ledger' => $d->required_hours ? $hours >= $d->required_hours : $hours > 0,
                    'auto_attendance' => $rows->contains(fn ($a) => $a->clock_in_selfie_path || $a->clock_out_selfie_path),
                    'auto_duties' => ($taskCounts[$d->id] ?? 0) > 0,
                    'auto_photos' => ($photos[$d->id] ?? 0) > 0,
                    'auto_work_samples' => ($portfolio?->items_count ?? 0) > 0,
                    'auto_journal' => $rows->isNotEmpty() || ($activityDays[$d->id] ?? 0) > 0,
                    'auto_evaluation' => isset($evaluated[$d->id]),
                    default => true,
                };
                if ($ok) {
                    $done++;
                } elseif ($s['source'] === 'document') {
                    $missingDocs++;
                }
            }

            $out[$d->id] = ['done' => $done, 'total' => $sections->count(), 'missing_documents' => $missingDocs];
        }

        return $out;
    }

    private static function isImage(?string $path, ?string $mime): bool
    {
        if ($mime && str_starts_with($mime, 'image/')) {
            return true;
        }

        return in_array(strtolower(pathinfo((string) $path, PATHINFO_EXTENSION)), self::IMAGE_EXTENSIONS, true);
    }
}
