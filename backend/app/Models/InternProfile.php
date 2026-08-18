<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InternProfile extends Model
{
    protected $fillable = ['user_id', 'school_id', 'student_number', 'course', 'year_level', 'required_hours'];
}
