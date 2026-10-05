<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per school that customised its printed narrative report. No row =
 * the built-in default pattern (see NarrativeTemplateService::defaults).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('narrative_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('school_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('logo_path')->nullable();
            $table->json('letterhead')->nullable(); // school_name, address, contact, website
            $table->json('cover')->nullable();      // department, program_text, submitted_to_name, submitted_to_title, school_year
            $table->json('sections')->nullable();   // ordered [{key, title, source, document_type?, body?}]
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('narrative_templates');
    }
};
