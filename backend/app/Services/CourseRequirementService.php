<?php

namespace App\Services;

use App\Models\CourseRequirement;
use App\Models\CourseRequirementSet;
use App\Models\Document;
use App\Models\InternProfile;
use App\Models\InternshipDeployment;
use App\Models\School;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The documents each course must submit, set per school by its coordinator.
 *
 * No course_requirement_sets row for a course = the default, which is exactly
 * what the system always required: the `document` sections of the school's
 * narrative template. A configured course requires only what its coordinator
 * ticked (plus custom names they added). Uploads are matched to a requirement
 * by document type, case-insensitive and trimmed. Nothing here deletes a
 * Document: a requirement that is removed simply stops counting as required.
 */
class CourseRequirementService
{
    /** The document types the system offers by default (the old hard-coded dropdown, minus "Other"). */
    public const BUILTIN_TYPES = [
        'Endorsement Letter',
        'Brgy. Clearance',
        'Waiver',
        'Resume',
        'Certificate of Completion',
        'Performance Evaluation',
        'Memorandum of Agreement',
        'Medical Certificate',
        'Insurance',
    ];

    /** Mirrors COURSE_OPTIONS in frontend/src/lib/internOptions.js. */
    public const KNOWN_COURSES = ['BSIT', 'BSTM', 'BSBA', 'BSHM', 'BSAIS', 'BTELED', 'BSCRIM'];

    public const MAX_REQUIREMENTS = 30;
    public const MAX_NAME_LENGTH = 100;

    /** @var array<string, array{course:string, types:array<int,string>}> keyed by lowercase course */
    private array $sets = [];

    /** @var array<int, string> */
    private array $default = [];

    private function __construct(private readonly School $school)
    {
    }

    public static function forSchool(School $school): self
    {
        $me = new self($school);

        $me->default = collect(NarrativeTemplateService::resolve($school)['sections'])
            ->filter(fn ($s) => ($s['source'] ?? null) === 'document')
            ->map(fn ($s) => trim((string) ($s['document_type'] ?? $s['title'])))
            ->filter()
            ->unique(fn ($t) => self::norm($t))
            ->values()
            ->all();

        foreach (CourseRequirementSet::where('school_id', $school->id)->get() as $set) {
            $me->sets[self::norm($set->course)] = ['course' => $set->course, 'types' => []];
        }
        foreach (CourseRequirement::where('school_id', $school->id)->orderBy('sort_order')->orderBy('id')->get() as $row) {
            $key = self::norm($row->course);
            if (isset($me->sets[$key])) {
                $me->sets[$key]['types'][] = $row->document_type;
            }
        }

        return $me;
    }

    /** Lowercase, trimmed, inner whitespace collapsed: how two type or course names are compared. */
    public static function norm(?string $value): string
    {
        return mb_strtolower(trim(preg_replace('/\s+/u', ' ', (string) $value)));
    }

    /** Trimmed with inner whitespace collapsed (what gets stored). */
    public static function tidy(?string $value): string
    {
        return trim(preg_replace('/\s+/u', ' ', (string) $value));
    }

    public function defaultTypes(): array
    {
        return $this->default;
    }

    public function isConfigured(?string $course): bool
    {
        return $course !== null && self::norm($course) !== '' && isset($this->sets[self::norm($course)]);
    }

    /** Ordered document types the course requires (the default set when not configured or no course). */
    public function typesFor(?string $course): array
    {
        return $this->isConfigured($course) ? $this->sets[self::norm($course)]['types'] : $this->default;
    }

    // ---------------------------------------------------------------
    // Coordinator settings
    // ---------------------------------------------------------------

    /** Courses of this school with intern counts: the listed programs, any course an intern has, any configured one. */
    public function courses(): array
    {
        $counts = [];
        foreach (InternProfile::where('school_id', $this->school->id)->whereNotNull('course')->pluck('course') as $c) {
            $c = self::tidy($c);
            if ($c !== '') {
                $k = self::norm($c);
                $counts[$k] = ['name' => $counts[$k]['name'] ?? $c, 'interns' => ($counts[$k]['interns'] ?? 0) + 1];
            }
        }

        $out = [];
        foreach (self::KNOWN_COURSES as $c) {
            $out[self::norm($c)] = ['name' => $c, 'interns_count' => $counts[self::norm($c)]['interns'] ?? 0];
        }
        foreach ($counts as $k => $c) {
            $out[$k] ??= ['name' => $c['name'], 'interns_count' => $c['interns']];
        }
        foreach ($this->sets as $k => $s) {
            $out[$k] ??= ['name' => $s['course'], 'interns_count' => 0];
        }

        return array_values(array_map(fn ($c) => $c + [
            'configured' => isset($this->sets[self::norm($c['name'])]),
            'requirements' => $this->typesFor($c['name']),
        ], $out));
    }

    /** Canonical spelling of a course of this school, or null when it is not one of them. */
    public function canonicalCourse(?string $course): ?string
    {
        $k = self::norm($course);
        foreach ($this->courses() as $c) {
            if (self::norm($c['name']) === $k) {
                return $c['name'];
            }
        }

        return null;
    }

    /** Built-in choices first, then every custom name any course of this school uses. */
    public function choices(): array
    {
        $out = array_map(fn ($t) => ['name' => $t, 'builtin' => true], self::BUILTIN_TYPES);
        $seen = array_map([self::class, 'norm'], self::BUILTIN_TYPES);
        foreach ($this->customTypes() as $t) {
            $out[] = ['name' => $t, 'builtin' => false];
            $seen[] = self::norm($t);
        }
        // The default set may name a type of a customised template that is not a built-in.
        foreach ($this->default as $t) {
            if (!in_array(self::norm($t), $seen, true)) {
                $out[] = ['name' => $t, 'builtin' => false];
                $seen[] = self::norm($t);
            }
        }

        return $out;
    }

    /** @return array<int,string> custom (non built-in) names used by any configured course, first spelling wins */
    public function customTypes(): array
    {
        $builtin = array_map([self::class, 'norm'], self::BUILTIN_TYPES);
        $out = [];
        foreach ($this->sets as $s) {
            foreach ($s['types'] as $t) {
                $k = self::norm($t);
                if (!in_array($k, $builtin, true)) {
                    $out[$k] ??= $t;
                }
            }
        }

        return array_values($out);
    }

    /** The spelling the school already uses for a name (built-in, or an existing custom one), else the tidy input. */
    public function canonicalType(string $name): string
    {
        $k = self::norm($name);
        foreach (array_merge(self::BUILTIN_TYPES, $this->customTypes(), $this->default) as $known) {
            if (self::norm($known) === $k) {
                return $known;
            }
        }

        return self::tidy($name);
    }

    public function isBuiltin(string $name): bool
    {
        return in_array(self::norm($name), array_map([self::class, 'norm'], self::BUILTIN_TYPES), true);
    }

    /** Replace a course's requirements (ordered). $types must be canonical, unique and validated by the caller. */
    public function save(string $course, array $types): void
    {
        DB::transaction(function () use ($course, $types) {
            CourseRequirementSet::firstOrCreate(['school_id' => $this->school->id, 'course' => $course]);
            // Serialises two coordinators saving the same course at once (otherwise the second
            // insert hits the unique key and fails with a 500 half way through).
            CourseRequirementSet::where('school_id', $this->school->id)->where('course', $course)->lockForUpdate()->first();
            CourseRequirement::where('school_id', $this->school->id)->where('course', $course)->delete();
            foreach (array_values($types) as $i => $type) {
                CourseRequirement::create(['school_id' => $this->school->id, 'course' => $course, 'document_type' => $type, 'sort_order' => $i]);
            }
        });
    }

    /** Back to the default set. */
    public function reset(string $course): void
    {
        DB::transaction(function () use ($course) {
            CourseRequirement::where('school_id', $this->school->id)->where('course', $course)->delete();
            CourseRequirementSet::where('school_id', $this->school->id)->where('course', $course)->delete();
        });
    }

    /**
     * Rename a custom requirement everywhere in this school: its place in every
     * course, and the type of documents already uploaded under the old name, so
     * nothing that was uploaded stops matching. Returns how many documents followed.
     */
    public function rename(string $from, string $to): int
    {
        return DB::transaction(function () use ($from, $to) {
            $fromKey = self::norm($from);
            foreach (CourseRequirement::where('school_id', $this->school->id)->get() as $row) {
                if (self::norm($row->document_type) === $fromKey) {
                    $row->update(['document_type' => $to]);
                }
            }

            $moved = 0;
            $deploymentIds = InternshipDeployment::where('school_id', $this->school->id)->pluck('id');
            foreach (Document::whereIn('deployment_id', $deploymentIds)->get(['id', 'document_type']) as $doc) {
                if (self::norm($doc->document_type) === $fromKey) {
                    Document::whereKey($doc->id)->update(['document_type' => $to]);
                    $moved++;
                }
            }

            return $moved;
        });
    }

    // ---------------------------------------------------------------
    // Intern / coordinator upload dropdowns
    // ---------------------------------------------------------------

    /**
     * What one deployment's intern must submit, with the state of each
     * requirement, and the other types an upload may use.
     *
     * @return array{course:?string, is_default:bool, requirements:array<int,array>, others:array<int,string>}
     */
    public function payloadFor(InternshipDeployment $d): array
    {
        $course = InternProfile::where('user_id', $d->intern_id)->where('school_id', $d->school_id)->value('course');
        $course = self::tidy($course) !== '' ? self::tidy($course) : null;
        $types = $this->typesFor($course);

        $docs = Document::where('deployment_id', $d->id)->orderByDesc('id')->get(['id', 'document_type', 'status']);
        $requirements = [];
        foreach ($types as $type) {
            $mine = $docs->filter(fn ($x) => self::norm($x->document_type) === self::norm($type));
            $best = $mine->firstWhere('status', 'approved') ?? $mine->firstWhere('status', 'pending') ?? $mine->first();
            $requirements[] = [
                'document_type' => $type,
                'status' => $best ? $best->status : 'not_uploaded',
                'document_id' => $best?->id,
            ];
        }

        $required = array_map([self::class, 'norm'], $types);
        $others = array_values(array_filter(
            array_map(fn ($c) => $c['name'], $this->choices()),
            fn ($name) => !in_array(self::norm($name), $required, true)
        ));

        return [
            'course' => $course,
            'is_default' => !$this->isConfigured($course),
            'requirements' => $requirements,
            'others' => $others,
        ];
    }

    // ---------------------------------------------------------------
    // Narrative report
    // ---------------------------------------------------------------

    /**
     * Fit a template's sections to a course's requirements:
     *  - a document section for a required type is kept (required: true);
     *  - a document section for a type that is NOT required is kept only when
     *    the intern uploaded that type (required: false), otherwise left out;
     *  - a required type the template has no section for is added as a new
     *    document section (before the ledger).
     * Sections of other sources are untouched.
     *
     * @param  array<int,array>  $sections
     * @param  array<int,string>  $required        document types the course requires
     * @param  array<int,string>  $uploadedNorm    normalised types the intern has any document of
     */
    public static function applyToSections(array $sections, array $required, array $uploadedNorm): array
    {
        $requiredNorm = array_map([self::class, 'norm'], $required);
        $present = [];
        $out = [];
        foreach ($sections as $s) {
            if (($s['source'] ?? null) !== 'document') {
                $out[] = $s;

                continue;
            }
            $k = self::norm($s['document_type'] ?? $s['title']);
            $present[$k] = true;
            $isRequired = in_array($k, $requiredNorm, true);
            if (!$isRequired && !in_array($k, $uploadedNorm, true)) {
                continue;
            }
            $s['required'] = $isRequired;
            $out[] = $s;
        }

        $extra = [];
        foreach ($required as $type) {
            if (!isset($present[self::norm($type)])) {
                $extra[] = [
                    'key' => 'req_' . Str::limit(Str::slug($type, '_'), 30, '') . '_' . substr(md5(self::norm($type)), 0, 6),
                    'title' => mb_strtoupper($type),
                    'source' => 'document',
                    'document_type' => $type,
                    'required' => true,
                ];
            }
        }
        if ($extra) {
            $at = count($out);
            foreach ($out as $i => $s) {
                if (($s['source'] ?? null) === 'auto_ledger') {
                    $at = $i;
                    break;
                }
            }
            array_splice($out, $at, 0, $extra);
        }

        return $out;
    }
}
