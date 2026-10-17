<?php

use App\Support\Courses;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The courses each school offers ("Courses offered" in Settings). Only these can be picked when interns are added
 * or imported. required_hours NULL = the catalog default (see App\Support\Courses).
 *
 * Additive: every existing school is backfilled with the distinct courses its interns already have and the ones
 * it configured document requirements for, so nothing that exists stops working. down() drops the table; the
 * interns' own course values are untouched either way. The two requirement tables are widened to 150 so a custom
 * program name that long can have its own document requirements.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('school_courses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->string('name', 150);
            $table->unsignedSmallInteger('required_hours')->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['school_id', 'name']);
        });

        Schema::table('course_requirement_sets', fn (Blueprint $t) => $t->string('course', 150)->change());
        Schema::table('course_requirements', fn (Blueprint $t) => $t->string('course', 150)->change());

        $this->backfill();
    }

    public function down(): void
    {
        Schema::dropIfExists('school_courses');
    }

    private function backfill(): void
    {
        $perSchool = [];
        $add = function (int $schoolId, ?string $course) use (&$perSchool) {
            $name = Courses::canonical($course);
            if ($name === null || $name === '') {
                return;
            }
            $name = mb_substr($name, 0, 150);
            $perSchool[$schoolId][mb_strtolower($name)] ??= ['name' => $name, 'interns' => 0];
        };

        foreach (DB::table('intern_profiles')->whereNotNull('course')->get(['school_id', 'course']) as $row) {
            $add((int) $row->school_id, $row->course);
            $name = Courses::canonical($row->course);
            if ($name !== null && $name !== '') {
                $perSchool[(int) $row->school_id][mb_strtolower(mb_substr($name, 0, 150))]['interns']++;
            }
        }
        foreach (DB::table('course_requirement_sets')->get(['school_id', 'course']) as $row) {
            $add((int) $row->school_id, $row->course);
        }

        $now = now();
        $schoolIds = DB::table('schools')->pluck('id')->flip();
        foreach ($perSchool as $schoolId => $courses) {
            if (!isset($schoolIds[$schoolId])) {
                continue; // an orphan row must not break the foreign key
            }
            // Most-used first, then by name, so the list a school sees is stable.
            uasort($courses, fn ($a, $b) => [$b['interns'], $a['name']] <=> [$a['interns'], $b['name']]);
            $order = 0;
            foreach ($courses as $c) {
                DB::table('school_courses')->insert([
                    'school_id' => $schoolId,
                    'name' => $c['name'],
                    'required_hours' => null,
                    'sort_order' => $order++,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }
};
