<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Reassigning an intern edits the SAME deployment in place (company and
 * supervisor change, everything logged stays on it). This table is the
 * history: one row per move, so the deployment history, the narrative report's
 * per-date company and the old company's "Transferred out" list can be built.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('deployment_transfers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('deployment_id')->constrained('internship_deployments')->cascadeOnDelete();
            $table->foreignId('from_company_id')->nullable()->constrained('companies')->nullOnDelete();
            $table->foreignId('from_supervisor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('to_company_id')->nullable()->constrained('companies')->nullOnDelete();
            $table->foreignId('to_supervisor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->date('transferred_on');
            $table->decimal('approved_hours_at_transfer', 8, 2)->default(0);
            $table->foreignId('transferred_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('note')->nullable();
            $table->timestamps();

            $table->index(['deployment_id', 'transferred_on']);
            $table->index('from_company_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deployment_transfers');
    }
};
