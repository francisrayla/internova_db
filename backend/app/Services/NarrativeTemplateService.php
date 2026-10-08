<?php

namespace App\Services;

use App\Models\CoordinatorProfile;
use App\Models\NarrativeTemplate;
use App\Models\School;
use Carbon\CarbonInterface;

/**
 * A narrative report template = letterhead + cover fields + ordered sections,
 * each with a `source` telling the renderer where its content comes from.
 * A school with no NarrativeTemplate row gets defaults() built from its own
 * record; a row only overrides what it stores.
 */
class NarrativeTemplateService
{
    public const LETTERHEAD_FIELDS = ['school_name', 'address', 'contact', 'website'];
    public const COVER_FIELDS = ['department', 'program_text', 'submitted_to_name', 'submitted_to_title', 'school_year'];

    public const DUTIES_INTRO = 'On-the-Job Training is the method of applying information and skills in a practical situation. It allows students to obtain work experience in a workplace context.';

    public const CO_RESPONSIBILITY_BODY = "The {school_name} commits to provide students of the real-world application of the theories and principles learned in school. This is partial realization of this commitment.\n"
        . "The college, through its OJT Coordinator, {coordinator_name}, shall be observing and supervising the student-trainees. The faculty however shall not be responsible for any intractable incident, God forbid, which is due to the negligence of the student or third party.\n"
        . "As total, the faculty shall observe due diligence but at the same time, shall expect the same observance and responsibility of the student to avoid untoward incident. Absence due to diligence from the student, the faculty, or college cannot be faulted.\n"
        . 'In conformity to this shared responsibility, we, the student, parent-guardian and faculty shall now commit, sign our names, and accept our co-responsibility.';

    public const CO_RESPONSIBILITY_REMARKS = 'Should be signed by all parties before the deployment of the student to the training provider. This will serve as waiver claim endorsement letter.';

    public static function defaultSections(): array
    {
        return [
            ['key' => 'acknowledgement', 'title' => 'ACKNOWLEDGEMENT', 'source' => 'intern_text'],
            ['key' => 'endorsement_letter', 'title' => 'ENDORSEMENT LETTER', 'source' => 'document', 'document_type' => 'Endorsement Letter'],
            ['key' => 'brgy_clearance', 'title' => 'BRGY. CLEARANCE', 'source' => 'document', 'document_type' => 'Brgy. Clearance'],
            ['key' => 'waiver', 'title' => 'WAIVER', 'source' => 'document', 'document_type' => 'Waiver'],
            ['key' => 'resume', 'title' => 'RESUME', 'source' => 'document', 'document_type' => 'Resume'],
            ['key' => 'apprentice_ledger', 'title' => 'APPRENTICE LEDGER', 'source' => 'auto_ledger'],
            ['key' => 'duties', 'title' => 'DESCRIPTION OF DUTIES AND RESPONSIBILITIES', 'source' => 'auto_duties'],
            ['key' => 'apprenticeship_in_action', 'title' => 'APPRENTICESHIP IN ACTION', 'source' => 'auto_photos'],
            ['key' => 'work_samples', 'title' => 'SAMPLES OF WORK DONE/OUTPUTS', 'source' => 'auto_work_samples'],
            ['key' => 'certificate_of_completion', 'title' => 'CERTIFICATE OF COMPLETION', 'source' => 'document', 'document_type' => 'Certificate of Completion'],
            ['key' => 'personal_observation', 'title' => 'PERSONAL OBSERVATION', 'source' => 'intern_text'],
            ['key' => 'journal', 'title' => "STUDENT'S JOURNAL", 'source' => 'auto_journal'],
            [
                'key' => 'co_responsibility',
                'title' => 'STATEMENT OF CO-RESPONSIBILITY',
                'source' => 'fixed_text',
                'body' => self::CO_RESPONSIBILITY_BODY,
                'signatures' => true,
                'remarks' => self::CO_RESPONSIBILITY_REMARKS,
            ],
            ['key' => 'suggestion', 'title' => 'SUGGESTION TO IMPROVE THE STUDENT APPRENTICESHIP PROGRAM', 'source' => 'intern_text'],
            // Always the last pages of the report (resolve() keeps it there), shown only once the intern is evaluated.
            ['key' => 'performance_evaluation', 'title' => 'PERFORMANCE EVALUATION REPORT', 'source' => 'auto_evaluation'],
        ];
    }

    /** Primary coordinator of the school (fallback: any coordinator profile). */
    public static function primaryCoordinator(int $schoolId): ?CoordinatorProfile
    {
        $profiles = CoordinatorProfile::with('user')->where('school_id', $schoolId)->get();

        return $profiles->firstWhere('is_primary_coordinator', true) ?? $profiles->first();
    }

    public static function defaults(School $school): array
    {
        $coordinator = self::primaryCoordinator($school->id);
        $coordinatorName = $coordinator?->user
            ? (trim("{$coordinator->user->first_name} {$coordinator->user->last_name}") ?: $coordinator->user->name)
            : null;

        return [
            'letterhead' => [
                'school_name' => $school->school_name,
                'address' => $school->address,
                'contact' => $school->contact_number ? "Tel. No.: {$school->contact_number}" : null,
                'website' => null,
            ],
            'cover' => [
                'department' => null,
                'program_text' => 'In Partial Fulfillment of the Requirements in Apprenticeship Program',
                'submitted_to_name' => $coordinatorName,
                'submitted_to_title' => $coordinator?->position ?: 'OJT Coordinator',
                'school_year' => null,
            ],
            'sections' => self::defaultSections(),
        ];
    }

    /** June onwards starts a new school year (Y-(Y+1)), earlier months belong to (Y-1)-Y. */
    public static function deriveSchoolYear(?CarbonInterface $start): ?string
    {
        if (!$start) {
            return null;
        }

        return $start->month >= 6
            ? $start->year . '-' . ($start->year + 1)
            : ($start->year - 1) . '-' . $start->year;
    }

    /** The raw stored row (or null) — used by the coordinator editor. */
    public static function rowFor(int $schoolId): ?NarrativeTemplate
    {
        return NarrativeTemplate::where('school_id', $schoolId)->first();
    }

    /**
     * Template merged over the defaults. Stored null/missing values fall back
     * to the default; school_year falls back to the one derived from $start.
     * Placeholders in fixed_text bodies are filled with $vars.
     */
    public static function resolve(School $school, ?CarbonInterface $start = null, array $vars = []): array
    {
        $defaults = self::defaults($school);
        $row = self::rowFor($school->id);

        $merge = function (array $base, ?array $over) {
            foreach ($over ?? [] as $k => $v) {
                if ($v !== null) {
                    $base[$k] = $v;
                }
            }

            return $base;
        };

        $letterhead = $merge($defaults['letterhead'], $row?->letterhead);
        $cover = $merge($defaults['cover'], $row?->cover);
        $cover['school_year'] = $cover['school_year'] ?: self::deriveSchoolYear($start);
        // The attendance selfies no longer go in the report (the DTR table covers attendance),
        // including in templates a school saved before that.
        $sections = collect($row?->sections ?: $defaults['sections'])->reject(fn ($s) => ($s['source'] ?? null) === 'auto_attendance')->values();
        // The evaluation form is always the last section, even in a template saved with it elsewhere
        // (or without it). The renderers leave it out while the intern has no evaluation.
        $evaluationSection = $sections->firstWhere('source', 'auto_evaluation') ?? collect($defaults['sections'])->firstWhere('source', 'auto_evaluation');
        $sections = $sections->reject(fn ($s) => ($s['source'] ?? null) === 'auto_evaluation')->push($evaluationSection)->values()->all();

        $vars = array_merge([
            'school_name' => $letterhead['school_name'],
            'coordinator_name' => $cover['submitted_to_name'] ?? '',
        ], $vars);
        $replace = [];
        foreach ($vars as $k => $v) {
            $replace['{' . $k . '}'] = (string) $v;
        }
        $sections = array_map(function (array $s) use ($replace) {
            if (isset($s['body'])) {
                $s['body'] = strtr($s['body'], $replace);
            }

            return $s;
        }, $sections);

        return [
            'is_default' => $row === null,
            'logo_url' => $row?->logoUrl(),
            'letterhead' => $letterhead,
            'cover' => $cover,
            'sections' => array_values($sections),
        ];
    }
}
