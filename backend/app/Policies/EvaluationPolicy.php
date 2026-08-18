<?php

namespace App\Policies;

class EvaluationPolicy
{
    public function viewAny($user): bool
    {
        return true;
    }
}
