<?php

use App\Support\Courses;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Data only: courses saved as codes ("BSIT", "B.S.I.T.", "bsit") become their full names ("Bachelor of Science in
 * Information Technology") in intern profiles and in the per-course requirement tables. Programs that are not in
 * the list stay as typed. When a school already has a set under the full name, the duplicate code rows are dropped
 * instead of renamed (the unique keys would refuse a second one). down() turns the full names back into codes.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->rename(fn (string $value) => Courses::canonical($value));
    }

    public function down(): void
    {
        $codes = array_flip(Courses::NAMES);
        $this->rename(fn (string $value) => $codes[$value] ?? $value);
    }

    private function rename(callable $map): void
    {
        DB::transaction(function () use ($map) {
            foreach (DB::table('intern_profiles')->whereNotNull('course')->get(['id', 'course']) as $row) {
                $to = $map($row->course);
                if ($to !== $row->course) {
                    DB::table('intern_profiles')->where('id', $row->id)->update(['course' => $to]);
                }
            }

            foreach (DB::table('course_requirement_sets')->get(['id', 'school_id', 'course']) as $row) {
                $to = $map($row->course);
                if ($to === $row->course) {
                    continue;
                }
                $exists = DB::table('course_requirement_sets')->where('school_id', $row->school_id)->where('course', $to)->where('id', '!=', $row->id)->exists();
                if ($exists) {
                    DB::table('course_requirements')->where('school_id', $row->school_id)->where('course', $row->course)->delete();
                    DB::table('course_requirement_sets')->where('id', $row->id)->delete();
                    continue;
                }
                DB::table('course_requirement_sets')->where('id', $row->id)->update(['course' => $to]);
                DB::table('course_requirements')->where('school_id', $row->school_id)->where('course', $row->course)->update(['course' => $to]);
            }
        });
    }
};
