<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// When a supervisor corrects the time of an attendance the system closed automatically (the
// intern forgot to time out), remember who did it and when.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->foreignId('edited_by')->nullable()->after('auto_clocked_out')->constrained('users')->nullOnDelete();
            $table->timestamp('edited_at')->nullable()->after('edited_by');
        });
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropConstrainedForeignId('edited_by');
            $table->dropColumn('edited_at');
        });
    }
};
