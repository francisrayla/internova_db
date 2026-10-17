<?php

namespace App\Support;

/**
 * The catalog of degree programs a school can pick from ("Courses offered" in Settings). Programs are stored and
 * shown by their full names. Abbreviations typed in forms or Excel masterlists ("BSIT", "B.S.I.T.", "bsit",
 * "BSED-ENG") and old records saved as codes all map to the full name, so every screen, report and Word file
 * reads the same. Any other program a school types is kept as typed (a custom program).
 *
 * This is the single source: the API (GET school-courses) sends the catalog to the frontend, which has no copy.
 */
final class Courses
{
    /** code => full name, in picker order within each group (see GROUPS). */
    public const NAMES = [
        // IT & Computing
        'BSIT' => 'Bachelor of Science in Information Technology',
        'BSCS' => 'Bachelor of Science in Computer Science',
        'BSIS' => 'Bachelor of Science in Information Systems',
        'BSEMC' => 'Bachelor of Science in Entertainment and Multimedia Computing',
        'ACT' => 'Associate in Computer Technology',
        // Business & Accountancy
        'BSBA' => 'Bachelor of Science in Business Administration',
        'BSBA-MM' => 'Bachelor of Science in Business Administration major in Marketing Management',
        'BSBA-FM' => 'Bachelor of Science in Business Administration major in Financial Management',
        'BSBA-HRM' => 'Bachelor of Science in Business Administration major in Human Resource Management',
        'BSA' => 'Bachelor of Science in Accountancy',
        'BSMA' => 'Bachelor of Science in Management Accounting',
        'BSAIS' => 'Bachelor of Science in Accounting Information System',
        'BSENTREP' => 'Bachelor of Science in Entrepreneurship',
        'BSOA' => 'Bachelor of Science in Office Administration',
        'BSREM' => 'Bachelor of Science in Real Estate Management',
        // Hospitality & Tourism
        'BSHM' => 'Bachelor of Science in Hospitality Management',
        'BSTM' => 'Bachelor of Science in Tourism Management',
        'BSTRM' => 'Bachelor of Science in Travel Management',
        // Education
        'BEED' => 'Bachelor of Elementary Education',
        'BSED-ENG' => 'Bachelor of Secondary Education major in English',
        'BSED-MATH' => 'Bachelor of Secondary Education major in Mathematics',
        'BSED-SCI' => 'Bachelor of Secondary Education major in Science',
        'BSED-FIL' => 'Bachelor of Secondary Education major in Filipino',
        'BSED-SS' => 'Bachelor of Secondary Education major in Social Studies',
        'BPED' => 'Bachelor of Physical Education',
        'BTVTED' => 'Bachelor of Technical-Vocational Teacher Education',
        'BECED' => 'Bachelor of Early Childhood Education',
        'BTELED' => 'Bachelor of Technology and Livelihood Education',
        // Engineering & Technology
        'BSCE' => 'Bachelor of Science in Civil Engineering',
        'BSEE' => 'Bachelor of Science in Electrical Engineering',
        'BSME' => 'Bachelor of Science in Mechanical Engineering',
        'BSECE' => 'Bachelor of Science in Electronics Engineering',
        'BSCPE' => 'Bachelor of Science in Computer Engineering',
        'BINDTECH' => 'Bachelor of Industrial Technology',
        // Health
        'BSN' => 'Bachelor of Science in Nursing',
        'BSMLS' => 'Bachelor of Science in Medical Laboratory Science',
        'BSPHARMA' => 'Bachelor of Science in Pharmacy',
        'BSM' => 'Bachelor of Science in Midwifery',
        // Agriculture & Fisheries
        'BSAGRI' => 'Bachelor of Science in Agriculture',
        'BSF' => 'Bachelor of Science in Fisheries',
        'BSAB' => 'Bachelor of Science in Agribusiness',
        'BSFOR' => 'Bachelor of Science in Forestry',
        // Social Sciences & Others
        'BSSW' => 'Bachelor of Science in Social Work',
        'BSPSYCH' => 'Bachelor of Science in Psychology',
        'ABCOMM' => 'Bachelor of Arts in Communication',
        'BPA' => 'Bachelor of Public Administration',
        'BSCA' => 'Bachelor of Science in Customs Administration',
        'BSMARE' => 'Bachelor of Science in Marine Engineering',
        'BSMT' => 'Bachelor of Science in Marine Transportation',
        // Criminology
        'BSCRIM' => 'Bachelor of Science in Criminology',
    ];

    /** Group label => codes, in display order. Every code of NAMES appears in exactly one group. */
    public const GROUPS = [
        'IT & Computing' => ['BSIT', 'BSCS', 'BSIS', 'BSEMC', 'ACT'],
        'Business & Accountancy' => ['BSBA', 'BSBA-MM', 'BSBA-FM', 'BSBA-HRM', 'BSA', 'BSMA', 'BSAIS', 'BSENTREP', 'BSOA', 'BSREM'],
        'Hospitality & Tourism' => ['BSHM', 'BSTM', 'BSTRM'],
        'Education' => ['BEED', 'BSED-ENG', 'BSED-MATH', 'BSED-SCI', 'BSED-FIL', 'BSED-SS', 'BPED', 'BTVTED', 'BECED', 'BTELED'],
        'Engineering & Technology' => ['BSCE', 'BSEE', 'BSME', 'BSECE', 'BSCPE', 'BINDTECH'],
        'Health' => ['BSN', 'BSMLS', 'BSPHARMA', 'BSM'],
        'Agriculture & Fisheries' => ['BSAGRI', 'BSF', 'BSAB', 'BSFOR'],
        'Social Sciences & Others' => ['BSSW', 'BSPSYCH', 'ABCOMM', 'BPA', 'BSCA', 'BSMARE', 'BSMT'],
        'Criminology' => ['BSCRIM'],
    ];

    /** Other ways schools write the same codes (compared like codes: no case, dots, spaces or dashes). */
    private const ALIASES = [
        'BTLED' => 'BTELED',
        'BSCRIMINOLOGY' => 'BSCRIM',
        'BIT' => 'BINDTECH',
        'BSMEDTECH' => 'BSMLS',
    ];

    /** Default required OJT hours by code; everything else runs DEFAULT_HOURS. */
    private const HOURS = ['BSCRIM' => 250];

    public const DEFAULT_HOURS = 500;

    /** @var array<string, string>|null normalized code => code */
    private static ?array $codeIndex = null;

    /** @var array<string, string>|null lowercase full name => code */
    private static ?array $nameIndex = null;

    /** @return array<int, string> the full names, in picker order */
    public static function known(): array
    {
        return array_values(self::NAMES);
    }

    /** Code with case, dots, spaces and dashes ignored: "bsed-eng", "B.S.E.D. ENG" and "BSEDENG" are the same. */
    private static function codeKey(string $value): string
    {
        return strtoupper(preg_replace('/[\s.\-]/u', '', $value));
    }

    private static function indexes(): void
    {
        if (self::$codeIndex !== null) {
            return;
        }
        $codes = [];
        $names = [];
        foreach (self::NAMES as $code => $name) {
            $codes[self::codeKey($code)] = $code;
            $names[mb_strtolower($name)] = $code;
        }
        foreach (self::ALIASES as $alias => $code) {
            $codes[self::codeKey($alias)] ??= $code;
        }
        self::$codeIndex = $codes;
        self::$nameIndex = $names;
    }

    /** Catalog code for a code, alias, long form or full name; null for a custom program. */
    public static function codeFor(?string $value): ?string
    {
        $tidy = trim(preg_replace('/\s+/u', ' ', (string) $value));
        if ($tidy === '') {
            return null;
        }
        self::indexes();
        $key = self::codeKey($tidy);
        if (isset(self::$codeIndex[$key])) {
            return self::$codeIndex[$key];
        }
        $lower = mb_strtolower(str_replace('.', ' ', $tidy));
        $lower = trim(preg_replace('/\s+/u', ' ', $lower));
        if (isset(self::$nameIndex[$lower])) {
            return self::$nameIndex[$lower];
        }
        // "BS Information Technology", "B.S. in Tourism Management": the short "BS" for "Bachelor of Science in";
        // "AB Communication": "AB" for "Bachelor of Arts in".
        foreach (['/^b\s*s\s+(in\s+)?/' => 'bachelor of science in ', '/^(a\s*b|b\s*a)\s+(in\s+)?/' => 'bachelor of arts in '] as $pattern => $prefix) {
            $long = trim(preg_replace('/\s+/u', ' ', preg_replace($pattern, $prefix, $lower)));
            if ($long !== $lower && isset(self::$nameIndex[$long])) {
                return self::$nameIndex[$long];
            }
        }

        return null;
    }

    /** Full name for a listed program (by code or by name, any case or spacing); anything else tidied as typed. */
    public static function canonical(?string $value): ?string
    {
        $tidy = trim(preg_replace('/\s+/u', ' ', (string) $value));
        if ($tidy === '') {
            return $value === null ? null : '';
        }
        $code = self::codeFor($tidy);

        return $code !== null ? self::NAMES[$code] : $tidy;
    }

    /** Default required hours for a course (catalog value, else 500 — also for a custom program). */
    public static function defaultHours(?string $value): int
    {
        $code = self::codeFor($value);

        return ($code !== null ? (self::HOURS[$code] ?? null) : null) ?? self::DEFAULT_HOURS;
    }

    /** The catalog grouped for the UI: [{label, courses:[{code, name, default_hours, aliases}]}]. */
    public static function catalog(): array
    {
        $aliasesOf = [];
        foreach (self::ALIASES as $alias => $code) {
            $aliasesOf[$code][] = $alias;
        }
        $groups = [];
        foreach (self::GROUPS as $label => $codes) {
            $groups[] = [
                'label' => $label,
                'courses' => array_map(fn (string $code) => [
                    'code' => $code,
                    'name' => self::NAMES[$code],
                    'default_hours' => self::HOURS[$code] ?? self::DEFAULT_HOURS,
                    'aliases' => $aliasesOf[$code] ?? [],
                ], $codes),
            ];
        }

        return $groups;
    }
}
