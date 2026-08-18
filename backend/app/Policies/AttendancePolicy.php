<?php

namespace App\Policies;

class AttendancePolicy
{
    public function viewAny($user): bool
    {
        return true;
    }
}
