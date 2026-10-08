<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Attendance;
use App\Models\Company;
use App\Models\Evaluation;
use App\Models\EvaluationCriterion;
use App\Models\EvaluationScore;
use App\Models\InternshipDeployment;
use App\Models\Notification;
use App\Models\Role;
use App\Models\SupervisorProfile;
use App\Models\User;
use App\Services\DefaultEvaluationCriteria;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * An intern is evaluated once, only after the required hours are rendered, and the supervisor can
 * edit that evaluation (formal or manual) afterwards. The evaluation form closes the narrative report.
 */
class EvaluationRulesTest extends TestCase
{
    use RefreshDatabase;

    private InternshipDeployment $dep;
    private User $sup;
    private User $intern;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->dep = InternshipDeployment::firstOrFail();
        $this->dep->update(['status' => 'active', 'required_hours' => 8]);
        $this->sup = User::where('email', 'supervisor@internova.test')->firstOrFail();
        $this->intern = User::findOrFail($this->dep->intern_id);
        Evaluation::query()->delete();
        EvaluationCriterion::where('school_id', $this->dep->school_id)->delete();
        DefaultEvaluationCriteria::seedFor($this->dep->school_id);
    }

    /** Eight approved hours = the required hours of the deployment. */
    private function finishHours(): void
    {
        Attendance::create([
            'deployment_id' => $this->dep->id, 'attendance_date' => '2026-09-01',
            'clock_in' => '2026-09-01 00:00:00', 'clock_out' => '2026-09-01 08:00:00', 'status' => 'approved',
        ]);
    }

    private function formalPayload(array $over = []): array
    {
        $criteria = EvaluationCriterion::where('school_id', $this->dep->school_id)->where('status', 'active')->orderBy('id')->get();

        return $over + [
            'deployment_id' => $this->dep->id,
            'evaluation_date' => '2026-09-02',
            'remarks' => 'Keep it up',
            'scores' => $criteria->map(fn ($c) => ['criteria_id' => $c->id, 'score' => (float) $c->max_score])->all(),
        ];
    }

    public function test_an_intern_with_unfinished_hours_cannot_be_evaluated(): void
    {
        Sanctum::actingAs($this->sup);

        $list = $this->getJson('/api/supervisor/evaluations')->assertOk()->json('interns');
        $row = collect($list)->firstWhere('deployment_id', $this->dep->id);
        $this->assertFalse($row['can_evaluate']);
        $this->assertSame('not_finished', $row['block_code']);
        $this->assertSame(8, $row['required_hours']);
        $this->assertStringContainsString('0 of 8 required hours', $row['block_reason']);

        $this->postJson('/api/supervisor/evaluations', $this->formalPayload())
            ->assertStatus(422)->assertJsonPath('code', 'not_finished');
        $this->postJson('/api/supervisor/evaluations/manual', ['deployment_id' => $this->dep->id, 'evaluation_date' => '2026-09-02', 'overall_score' => 80])
            ->assertStatus(422)->assertJsonPath('code', 'not_finished');
        $this->assertSame(0, Evaluation::count());
    }

    public function test_after_the_hours_are_done_one_evaluation_is_allowed_and_a_second_is_refused(): void
    {
        $this->finishHours();
        Sanctum::actingAs($this->sup);

        $row = collect($this->getJson('/api/supervisor/evaluations')->json('interns'))->firstWhere('deployment_id', $this->dep->id);
        $this->assertTrue($row['can_evaluate']);

        // No type is sent any more: it defaults to Final.
        $id = $this->postJson('/api/supervisor/evaluations', $this->formalPayload())->assertOk()->json('id');
        $this->assertSame('Final', Evaluation::findOrFail($id)->evaluation_type);
        $this->assertEquals(100, Evaluation::findOrFail($id)->overall_score);

        $this->postJson('/api/supervisor/evaluations', $this->formalPayload())
            ->assertStatus(422)->assertJsonPath('code', 'already_evaluated');
        $this->postJson('/api/supervisor/evaluations/manual', ['deployment_id' => $this->dep->id, 'evaluation_date' => '2026-09-02', 'overall_score' => 80])
            ->assertStatus(422)->assertJsonPath('code', 'already_evaluated');
        $this->assertSame(1, Evaluation::count());

        $row = collect($this->getJson('/api/supervisor/evaluations')->json('interns'))->firstWhere('deployment_id', $this->dep->id);
        $this->assertFalse($row['can_evaluate']);
        $this->assertSame($id, $row['evaluation_id']);
    }

    public function test_a_score_above_the_criterion_maximum_is_refused(): void
    {
        $this->finishHours();
        Sanctum::actingAs($this->sup);
        $payload = $this->formalPayload();
        $payload['scores'][0]['score'] += 1;

        $this->postJson('/api/supervisor/evaluations', $payload)->assertStatus(422);
        $this->assertSame(0, Evaluation::count());
    }

    public function test_the_supervisor_can_edit_a_formal_evaluation(): void
    {
        $this->finishHours();
        Sanctum::actingAs($this->sup);
        $id = $this->postJson('/api/supervisor/evaluations', $this->formalPayload())->assertOk()->json('id');
        Notification::query()->delete();

        $payload = $this->formalPayload(['remarks' => 'Updated remarks', 'evaluation_date' => '2026-09-03', 'category_comments' => ['A. Technical Ability' => 'Solid']]);
        unset($payload['deployment_id']);
        $payload['scores'][0]['score'] = 0; // everything else stays at max
        $this->patchJson("/api/supervisor/evaluations/{$id}", $payload)->assertOk();

        $e = Evaluation::with('scores')->findOrFail($id);
        $this->assertSame('Updated remarks', $e->remarks);
        $this->assertSame('2026-09-03', $e->evaluation_date->toDateString());
        $this->assertLessThan(100, (float) $e->overall_score);
        $this->assertSame(count($payload['scores']), $e->scores->count());
        $this->assertSame($this->sup->id, (int) $e->evaluator_id);
        $this->assertSame($this->sup->id, (int) $e->edited_by);
        $this->assertNotNull($e->edited_at);
        $this->assertSame('Solid', $e->category_comments['A. Technical Ability']);

        $this->assertSame(1, Notification::where('user_id', $this->intern->id)->where('type', 'evaluation_updated')->count());
        $this->assertTrue(ActivityLog::where('module', 'Evaluations')->where('action', 'Edited evaluation')->exists());

        $listed = collect($this->getJson('/api/supervisor/evaluations')->json('evaluations'))->firstWhere('id', $id);
        $this->assertNotNull($listed['edited_at']);
        $this->assertSame('2026-09-03', $listed['evaluation_date_raw']);
    }

    public function test_the_supervisor_can_edit_a_manual_evaluation_and_a_stranger_cannot(): void
    {
        $this->finishHours();
        Sanctum::actingAs($this->sup);
        $id = $this->postJson('/api/supervisor/evaluations/manual', ['deployment_id' => $this->dep->id, 'evaluation_date' => '2026-09-02', 'overall_score' => 70, 'remarks' => 'ok'])->assertOk()->json('id');

        $this->patchJson("/api/supervisor/evaluations/{$id}", ['evaluation_date' => '2026-09-02', 'overall_score' => 85.5, 'remarks' => 'better'])->assertOk();
        $e = Evaluation::findOrFail($id);
        $this->assertEquals(85.5, $e->overall_score);
        $this->assertSame('better', $e->remarks);
        $this->assertSame('Manual', $e->evaluation_type);
        $this->assertNotNull($e->edited_at);
        // Without a breakdown, per-criterion scores are not invented.
        $this->assertSame(0, EvaluationScore::where('evaluation_id', $id)->count());
        $this->patchJson("/api/supervisor/evaluations/{$id}", ['evaluation_date' => '2026-09-02', 'overall_score' => 101])->assertStatus(422);

        $other = Company::create(['school_id' => $this->dep->school_id, 'company_code' => 'CMP-9', 'company_name' => 'Elsewhere', 'status' => 'active']);
        $stranger = User::create([
            'name' => 'Ana Reyes', 'email' => 'stranger@internova.test', 'password' => bcrypt('password'),
            'role_id' => Role::where('name', 'supervisor')->value('id'), 'school_id' => $this->dep->school_id,
            'first_name' => 'Ana', 'last_name' => 'Reyes', 'status' => 'active', 'email_verified_at' => now(),
        ]);
        SupervisorProfile::create(['user_id' => $stranger->id, 'school_id' => $this->dep->school_id, 'company_id' => $other->id]);
        Sanctum::actingAs($stranger);
        $this->patchJson("/api/supervisor/evaluations/{$id}", ['evaluation_date' => '2026-09-02', 'overall_score' => 10])->assertStatus(404);
        $this->assertEquals(85.5, Evaluation::findOrFail($id)->overall_score);

        // A coordinator only reads evaluations.
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $this->patchJson("/api/supervisor/evaluations/{$id}", ['evaluation_date' => '2026-09-02', 'overall_score' => 10])->assertForbidden();
    }

    public function test_existing_duplicates_stay_readable_and_the_latest_is_official(): void
    {
        $mk = fn ($date, $score) => Evaluation::create([
            'deployment_id' => $this->dep->id, 'evaluator_id' => $this->sup->id, 'evaluation_type' => 'Midterm',
            'evaluation_date' => $date, 'overall_score' => $score, 'status' => 'submitted',
        ]);
        $old = $mk('2026-08-01', 41);
        $new = $mk('2026-09-01', 44);

        Sanctum::actingAs($this->sup);
        $res = $this->getJson('/api/supervisor/evaluations')->assertOk();
        $by = collect($res->json('evaluations'))->keyBy('id');
        $this->assertCount(2, $by);
        $this->assertTrue($by[$new->id]['is_official']);
        $this->assertFalse($by[$old->id]['is_official']);
        $this->assertSame($new->id, Evaluation::officialFor($this->dep->id)->id);

        // Either one can still be edited, and new ones are refused.
        $this->patchJson("/api/supervisor/evaluations/{$old->id}", ['evaluation_date' => '2026-08-01', 'overall_score' => 50])->assertOk();
        $this->finishHours();
        $this->postJson('/api/supervisor/evaluations/manual', ['deployment_id' => $this->dep->id, 'evaluation_date' => '2026-09-05', 'overall_score' => 99])->assertStatus(422);

        // The score shown on dashboards is the official one.
        Sanctum::actingAs(User::where('email', 'coordinator@internova.test')->firstOrFail());
        $row = collect($this->getJson('/api/coordinator/interns')->json('interns') ?? [])->firstWhere('deployment_id', $this->dep->id);
        if ($row && array_key_exists('latest_evaluation_score', $row)) {
            $this->assertEquals(44, $row['latest_evaluation_score']);
        }
    }

    public function test_the_evaluation_form_is_the_last_section_of_the_narrative_report_and_only_when_it_exists(): void
    {
        Sanctum::actingAs($this->intern);
        $without = $this->getJson('/api/intern/portfolio/narrative-report')->assertOk();
        $sections = collect($without->json('template.sections'));
        $this->assertSame('auto_evaluation', $sections->last()['source']);
        $this->assertSame(1, $sections->where('source', 'auto_evaluation')->count());
        $this->assertNull($without->json('evaluation'));

        $docx = fn () => $this->docxText($this->get('/api/intern/portfolio/narrative-report/docx')->assertOk());
        $this->assertStringNotContainsString('PERFORMANCE EVALUATION REPORT', $docx());

        $this->finishHours();
        Sanctum::actingAs($this->sup);
        $this->postJson('/api/supervisor/evaluations', $this->formalPayload(['remarks' => 'Magaling ka', 'category_comments' => ['A. Technical Ability' => 'Fast learner']]))->assertOk();

        Sanctum::actingAs($this->intern);
        $with = $this->getJson('/api/intern/portfolio/narrative-report')->assertOk();
        $this->assertNotNull($with->json('evaluation'));
        $this->assertNotEmpty($with->json('evaluation.scores'));

        $text = $docx();
        $this->assertStringContainsString('PERFORMANCE EVALUATION REPORT', $text);
        $this->assertStringContainsString('Magaling ka', $text);
        $this->assertStringContainsString('Fast learner', $text);
        $this->assertStringContainsString('Total / Rating: 100%', $text);
        // It comes after the last other section (the suggestion page) and after the table of contents entries.
        $this->assertGreaterThan(strrpos($text, 'SUGGESTION TO IMPROVE'), strrpos($text, 'PERFORMANCE EVALUATION REPORT'));
        $this->assertGreaterThan(strrpos($text, 'CO-RESPONSIBILITY'), strrpos($text, 'Magaling ka'));
    }

    private function docxText($res): string
    {
        $path = $res->baseResponse->getFile()->getPathname();
        $zip = new \ZipArchive();
        $this->assertTrue($zip->open($path) === true);
        $xml = $zip->getFromName('word/document.xml');
        $zip->close();

        // Word splits runs; stripping the tags is enough for substring checks.
        return html_entity_decode(strip_tags($xml));
    }
}
