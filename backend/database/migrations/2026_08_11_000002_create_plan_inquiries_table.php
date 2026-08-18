<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plan_inquiries', function (Blueprint $table) {
            $table->id();
            $table->string('school_name');
            $table->string('school_type')->nullable();
            $table->string('address')->nullable();
            $table->string('website')->nullable();
            $table->string('contact_person');
            $table->string('position')->nullable();
            $table->string('email');
            $table->string('phone')->nullable();
            $table->string('intern_range')->nullable();
            $table->string('expected_coordinators')->nullable();
            $table->string('interested_plan')->nullable();
            $table->string('heard_from')->nullable();
            $table->text('message')->nullable();
            $table->string('status')->default('new'); // new, contacted, under_discussion, approved, converted, rejected
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plan_inquiries');
    }
};
