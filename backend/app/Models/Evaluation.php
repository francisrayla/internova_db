<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Evaluation extends Model
{
    protected $fillable = ['deployment_id', 'evaluator_id', 'evaluation_type', 'evaluation_date', 'overall_score', 'remarks', 'category_comments', 'status'];

    protected $casts = [
        'evaluation_date' => 'date',
        'category_comments' => 'array',
    ];

    public function deployment()
    {
        return $this->belongsTo(InternshipDeployment::class, 'deployment_id');
    }

    public function evaluator()
    {
        return $this->belongsTo(User::class, 'evaluator_id');
    }

    public function scores()
    {
        return $this->hasMany(EvaluationScore::class, 'evaluation_id');
    }
}
