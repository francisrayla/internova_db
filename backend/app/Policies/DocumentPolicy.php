<?php

namespace App\Policies;

class DocumentPolicy
{
    public function viewAny($user): bool
    {
        return true;
    }
}
