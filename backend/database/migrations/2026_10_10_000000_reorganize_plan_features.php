<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Plain-language feature list per plan. Gates still match on exact labels
// (App\Services\PlanFeatures), so only the labels that gate nothing were
// reworded; "AI Portfolio / Reports" became "AI Narrative Writing" because the
// portfolio itself is now in every plan and only the AI writing is Premium.
return new class extends Migration
{
    private const RENAMES = [
        'Parent Task Management'            => 'Task Management (Pending / Ongoing / Done)',
        'Pending / Ongoing / Done tracking' => 'Task Management (Pending / Ongoing / Done)',
        'Basic Monitoring'                  => 'Basic Monitoring & Reports',
        'Real-time Chat'                    => 'Messaging & Group Chat',
        'AI Portfolio / Reports'            => 'AI Narrative Writing',
    ];

    private const CORE = [
        'GPS + Selfie Attendance',
        'Task Management (Pending / Ongoing / Done)',
        'Messaging & Group Chat',
        'Portfolio & Narrative Report',
        'Basic Monitoring & Reports',
    ];

    public function up(): void
    {
        foreach (DB::table('subscription_plans')->get() as $plan) {
            $features = json_decode($plan->features ?? '[]', true) ?: [];
            $features = array_map(fn ($f) => self::RENAMES[$f] ?? $f, $features);
            $features = array_merge(self::CORE, $features);
            // Evaluations are part of Basic now (it was Premium-only).
            if ($plan->name === 'Basic') {
                $features[] = 'Formal Evaluations';
            }

            DB::table('subscription_plans')->where('id', $plan->id)->update([
                'features'   => json_encode(array_values(array_unique($features))),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        // Labels are cosmetic apart from Formal Evaluations; nothing to undo safely.
    }
};
