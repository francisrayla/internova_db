<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which documents a school requires from the interns of one course.
 * course_requirement_sets marks a course as "configured" by its coordinator
 * (so a course can legitimately require nothing); course_requirements holds
 * its ordered document types. No set = the built-in default (see
 * CourseRequirementService::defaultTypes). Nothing here ever deletes a
 * Document: removing a requirement only stops it counting as required.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('course_requirement_sets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->string('course', 100);
            $table->timestamps();

            $table->unique(['school_id', 'course']);
        });

        Schema::create('course_requirements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->constrained()->cascadeOnDelete();
            $table->string('course', 100);
            $table->string('document_type', 100);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['school_id', 'course', 'document_type'], 'course_requirements_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('course_requirements');
        Schema::dropIfExists('course_requirement_sets');
    }
};
