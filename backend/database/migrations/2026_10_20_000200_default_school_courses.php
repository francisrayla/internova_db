<?php

use App\Services\SchoolCourseService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Data only: every school that has no courses offered yet gets the common ones (Courses::DEFAULT_OFFERED), the same
 * list a new school starts with, so it can add and import interns right away. Schools that already have a list keep
 * it. down() leaves the rows: by then the school may have edited them, and the table itself belongs to 000100.
 */
return new class extends Migration
{
    public function up(): void
    {
        $withCourses = DB::table('school_courses')->distinct()->pluck('school_id')->all();
        foreach (DB::table('schools')->whereNotIn('id', $withCourses)->pluck('id') as $schoolId) {
            SchoolCourseService::seedDefaults((int) $schoolId);
        }
    }

    public function down(): void
    {
    }
};
