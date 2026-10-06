<?php

namespace App\Services;

use App\Models\School;

/**
 * The single source of truth for what a school's current plan actually
 * unlocks — SubscriptionPlan.features already stores these exact labels
 * (shown as marketing copy on the plans/billing screens), so gating just
 * checks membership in that same array instead of maintaining a second,
 * easy-to-drift mapping. Every label common to both Basic and Premium needs
 * no gate at all; only the Premium-exclusive ones do.
 */
class PlanFeatures
{
    const SUBTASKS = 'Subtasks';
    const ATTACHMENTS = 'Attachments';
    const TASK_RATINGS = 'Per-task Rating + Comments';
    const FORMAL_EVALUATIONS = 'Formal Evaluations';
    const AI_FEATURES = 'AI Narrative Writing';

    public static function has(?School $school, string $feature): bool
    {
        $plan = $school?->currentSubscription()?->plan;
        return in_array($feature, $plan?->features ?? [], true);
    }
}
