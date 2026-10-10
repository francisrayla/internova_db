<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * There is one evaluation per intern, so the Prelim / Midterm / Final split is gone. The
     * evaluation_type column is kept (old rows keep their value, nothing is deleted or rewritten)
     * but it is now optional and ignored by the app: new evaluations leave it empty.
     */
    public function up(): void
    {
        Schema::table('evaluations', function (Blueprint $table) {
            $table->string('evaluation_type')->nullable()->change();
        });
    }

    public function down(): void
    {
        // The old column was NOT NULL: give empty ones a value first so the change can be undone.
        DB::table('evaluations')->whereNull('evaluation_type')->update(['evaluation_type' => 'Final']);

        Schema::table('evaluations', function (Blueprint $table) {
            $table->string('evaluation_type')->nullable(false)->change();
        });
    }
};
