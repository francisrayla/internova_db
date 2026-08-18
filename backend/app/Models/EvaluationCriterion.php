<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EvaluationCriterion extends Model
{
    protected $table = 'evaluation_criteria';

    protected $fillable = ['school_id', 'category', 'name', 'description', 'max_score', 'weight', 'status'];
}
