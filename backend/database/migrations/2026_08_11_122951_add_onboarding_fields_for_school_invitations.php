<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        DB::statement('ALTER TABLE users MODIFY password VARCHAR(255) NULL');

        Schema::table('users', function (Blueprint $table) {
            $table->string('invitation_token')->nullable()->unique()->after('remember_token');
            $table->timestamp('invitation_expires_at')->nullable()->after('invitation_token');
        });

        Schema::table('plan_inquiries', function (Blueprint $table) {
            $table->foreignId('school_id')->nullable()->after('id')->constrained()->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('plan_inquiries', function (Blueprint $table) {
            $table->dropConstrainedForeignId('school_id');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['invitation_token', 'invitation_expires_at']);
        });

        DB::statement("ALTER TABLE users MODIFY password VARCHAR(255) NOT NULL");
    }
};
