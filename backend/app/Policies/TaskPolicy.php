<?php

namespace App\Policies;

class TaskPolicy
{
    public function viewAny($user): bool
    {
        return true;
    }
}
