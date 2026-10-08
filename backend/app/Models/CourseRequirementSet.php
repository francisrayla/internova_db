<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Marks that a school's coordinator configured the requirements of a course (it may hold none). */
class CourseRequirementSet extends Model
{
    protected $fillable = ['school_id', 'course'];
}
