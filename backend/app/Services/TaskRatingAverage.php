<?php

namespace App\Services;

use App\Models\TaskEvaluation;

/**
 * Rolls up every task rating a supervisor has given an intern so far (1–10
 * each) into a single average — the raw material for auto-filling a
 * formal evaluation criterion flagged as derived_from_task_ratings.
 */
class TaskRatingAverage
{
    public static function forDeployment(int $deploymentId): ?float
    {
        $average = TaskEvaluation::whereHas('task.assignees', fn ($q) => $q->where('deployment_id', $deploymentId))
            ->avg('rating');

        return $average !== null ? round((float) $average, 2) : null;
    }

    /**
     * Scales a 1–10 task-rating average onto a criterion's own max_score —
     * e.g. an 8/10 average becomes 12/15 for a criterion capped at 15.
     */
    public static function scaledTo(float $average, float $maxScore): float
    {
        return round(($average / 10) * $maxScore, 2);
    }
}
