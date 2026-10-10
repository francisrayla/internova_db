<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Evaluation extends Model
{
    protected $fillable = ['deployment_id', 'evaluator_id', 'evaluation_date', 'overall_score', 'remarks', 'category_comments', 'status', 'edited_at', 'edited_by'];

    protected $casts = [
        'evaluation_date' => 'date',
        'category_comments' => 'array',
        'edited_at' => 'datetime',
    ];

    /**
     * An intern gets one evaluation per deployment. Older data can hold several, and then the
     * OFFICIAL one (the score on dashboards, the form at the end of the narrative report) is the
     * most recently dated, the newest id breaking a tie. Nothing else may pick "the latest" its own way.
     */
    public static function officialQuery(int $deploymentId)
    {
        return static::where('deployment_id', $deploymentId)->orderByDesc('evaluation_date')->orderByDesc('id');
    }

    public static function officialFor(int $deploymentId): ?self
    {
        return static::officialQuery($deploymentId)->first();
    }

    public function deployment()
    {
        return $this->belongsTo(InternshipDeployment::class, 'deployment_id');
    }

    public function evaluator()
    {
        return $this->belongsTo(User::class, 'evaluator_id');
    }

    public function editor()
    {
        return $this->belongsTo(User::class, 'edited_by');
    }

    public function scores()
    {
        return $this->hasMany(EvaluationScore::class, 'evaluation_id');
    }
}
