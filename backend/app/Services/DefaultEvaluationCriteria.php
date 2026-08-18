<?php

namespace App\Services;

use App\Models\EvaluationCriterion;

/**
 * The school's actual printed OJT evaluation form, transcribed into
 * seedable rows — every new school starts with this real rubric instead of
 * a blank one, and each item's max_score doubles as its percentage weight
 * (they're deliberately equal so a maxed-out evaluation totals exactly 100,
 * matching the paper form's "TOTAL 100%" row).
 */
class DefaultEvaluationCriteria
{
    public static function rows(): array
    {
        return [
            ['category' => 'A. Technical Ability', 'name' => 'Skills Possessed/Operations Performed', 'description' => null, 'max_score' => 15],
            ['category' => 'A. Technical Ability', 'name' => 'Quality of Work', 'description' => 'Thoroughness, accuracy, neatness and effectiveness', 'max_score' => 15],
            ['category' => 'A. Technical Ability', 'name' => 'Quantity of Work', 'description' => 'Ability to complete work on allotted time', 'max_score' => 15],

            ['category' => 'B. Interpersonal Skills', 'name' => 'Dependability, Reliability, Resourcefulness', 'description' => 'Ability to work with minimum supervision', 'max_score' => 10],
            ['category' => 'B. Interpersonal Skills', 'name' => 'Cooperation', 'description' => 'Works well with everyone, good team worker', 'max_score' => 10],
            ['category' => 'B. Interpersonal Skills', 'name' => 'Judgment', 'description' => 'Initiative, sound decisions, ability to identify factors/problems and act accordingly', 'max_score' => 10],
            ['category' => 'B. Interpersonal Skills', 'name' => 'Attitude', 'description' => 'The mental position taken about the job the individual is undertaking', 'max_score' => 5],

            ['category' => 'C. Time Management', 'name' => 'Attendance', 'description' => 'The individual is faithful in coming to work daily and adhering to work hours', 'max_score' => 5],
            ['category' => 'C. Time Management', 'name' => 'Punctuality', 'description' => 'The individual often reports to work on time', 'max_score' => 5],
            ['category' => 'C. Time Management', 'name' => 'Proper Observance/Use of Break Time Periods', 'description' => null, 'max_score' => 5],

            ['category' => 'D. Decorum and Personality', 'name' => 'Decorum and Personality', 'description' => 'Personal Grooming & Sound Disposition', 'max_score' => 5],
        ];
    }

    /**
     * Section subtitle shown once under each category heading in the UI —
     * kept out of the database since it's fixed copy from the printed
     * form, not per-school configurable data.
     */
    public static function categoryDescriptions(): array
    {
        return [
            'B. Interpersonal Skills' => "The measure of the trainee's ability to relate to one another and to operate within the division where he is assigned through social communication and interaction.",
        ];
    }

    public static function seedFor(int $schoolId): void
    {
        if (EvaluationCriterion::where('school_id', $schoolId)->exists()) {
            return;
        }

        foreach (self::rows() as $row) {
            EvaluationCriterion::create([
                'school_id' => $schoolId,
                'category' => $row['category'],
                'name' => $row['name'],
                'description' => $row['description'],
                'max_score' => $row['max_score'],
                'weight' => $row['max_score'],
                'status' => 'active',
            ]);
        }
    }
}
