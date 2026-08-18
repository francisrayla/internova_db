<?php

namespace App\Policies;

class MessagePolicy
{
    public function viewAny($user): bool
    {
        return true;
    }
}
