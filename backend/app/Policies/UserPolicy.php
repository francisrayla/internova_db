<?php

namespace App\Policies;

class UserPolicy
{
    public function viewAny($user): bool
    {
        return true;
    }
}
