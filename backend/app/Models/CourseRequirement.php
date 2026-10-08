<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One document type a school requires from the interns of one course (ordered). */
class CourseRequirement extends Model
{
    protected $fillable = ['school_id', 'course', 'document_type', 'sort_order'];
}
