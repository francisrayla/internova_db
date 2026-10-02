<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drops attendance_captures and task_attachments — both leftover from an
 * earlier, more elaborate design (geofenced attendance verification,
 * separate task file attachments) that was superseded by the simpler
 * shipped implementation (Attendance's own selfie+GPS columns, TaskProof).
 * Confirmed before dropping: zero rows in either table, zero code
 * references anywhere in the app, and zero foreign keys from other tables.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('attendance_captures');
        Schema::dropIfExists('task_attachments');
    }

    public function down(): void
    {
        Schema::create('attendance_captures', function (Blueprint $table) {
            $table->id();
            $table->foreignId('attendance_id')->constrained()->cascadeOnDelete();
            $table->string('capture_type')->nullable();
            $table->string('selfie_path')->nullable();
            $table->string('proof_image_path')->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->decimal('gps_accuracy', 8, 2)->nullable();
            $table->string('location_address')->nullable();
            $table->decimal('distance_from_company', 10, 2)->nullable();
            $table->boolean('within_allowed_area')->nullable();
            $table->boolean('verified')->default(false);
            $table->string('verification_note')->nullable();
            $table->timestamp('captured_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();
        });

        Schema::create('task_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('file_name')->nullable();
            $table->string('file_path')->nullable();
            $table->string('file_type')->nullable();
            $table->unsignedBigInteger('file_size')->nullable();
            $table->timestamps();
        });
    }
};
