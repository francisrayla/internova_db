<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Found by the coordinator QA pass: the API doors must accept the same people as the screens.
 */
class CoordinatorQaTest extends TestCase
{
    use RefreshDatabase;

    private User $coordinator;
    private Company $company;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $this->company = Company::where('school_id', $this->coordinator->school_id)->where('status', 'active')->firstOrFail();
        Sanctum::actingAs($this->coordinator);
    }

    private function internBody(array $over = []): array
    {
        return array_merge([
            'first_name' => 'Maria', 'last_name' => "O'Brien-Garcia", 'email' => 'maria.obrien@gmail.com',
            'course' => 'BSIT', 'year_level' => '4th Year', 'company_id' => $this->company->id,
            'start_date' => now('Asia/Manila')->toDateString(),
        ], $over);
    }

    public function test_add_intern_refuses_digits_or_markup_in_names_and_unknown_year_levels(): void
    {
        $this->postJson('/api/coordinator/interns', $this->internBody(['first_name' => '1234']))
            ->assertStatus(422)->assertJsonValidationErrors('first_name');
        $this->postJson('/api/coordinator/interns', $this->internBody(['last_name' => '<script>alert(1)</script>']))
            ->assertStatus(422)->assertJsonValidationErrors('last_name');
        $this->postJson('/api/coordinator/interns', $this->internBody(['year_level' => '<b>9th</b>']))
            ->assertStatus(422)->assertJsonValidationErrors('year_level');

        $this->postJson('/api/coordinator/interns', $this->internBody())->assertOk();
    }

    public function test_add_supervisor_refuses_digits_or_markup_in_names(): void
    {
        $this->postJson('/api/coordinator/supervisors', [
            'first_name' => '<b>x</b>', 'last_name' => 'Lee', 'email' => 'sup.lee@gmail.com', 'company_id' => $this->company->id,
        ])->assertStatus(422)->assertJsonValidationErrors('first_name');
    }

    public function test_reviewing_a_document_twice_does_not_notify_the_intern_twice(): void
    {
        $deployment = \App\Models\InternshipDeployment::where('school_id', $this->coordinator->school_id)->firstOrFail();
        $doc = \App\Models\Document::create([
            'deployment_id' => $deployment->id, 'uploaded_by' => $this->coordinator->id, 'document_type' => 'Resume',
            'file_name' => 'cv.pdf', 'file_path' => 'documents/x/cv.pdf', 'status' => 'pending',
        ]);
        $count = fn () => \App\Models\Notification::where('user_id', $deployment->intern_id)->where('type', 'document_reviewed')->count();
        $before = $count();

        $this->patchJson("/api/coordinator/documents/{$doc->id}", ['status' => 'rejected', 'remarks' => 'Blurry'])->assertOk();
        $this->patchJson("/api/coordinator/documents/{$doc->id}", ['status' => 'rejected', 'remarks' => 'Blurry'])->assertOk();

        $this->assertSame($before + 1, $count());
        $this->assertDatabaseHas('documents', ['id' => $doc->id, 'status' => 'rejected', 'remarks' => 'Blurry']);

        // A real change of mind is still saved and still told to the intern.
        $this->patchJson("/api/coordinator/documents/{$doc->id}", ['status' => 'approved'])->assertOk();
        $this->assertSame($before + 2, $count());
        $this->assertDatabaseHas('documents', ['id' => $doc->id, 'status' => 'approved', 'remarks' => null]);
    }

    public function test_criteria_can_be_edited_and_removed_but_scores_are_never_lost(): void
    {
        $id = $this->postJson('/api/coordinator/evaluation-criteria', ['name' => 'Punctuality', 'max_score' => 5, 'weight' => 1])
            ->assertOk()->json('criterion.id');

        $this->patchJson("/api/coordinator/evaluation-criteria/{$id}", ['name' => 'Being on time', 'max_score' => 8, 'weight' => 2])
            ->assertOk()->assertJsonPath('criterion.name', 'Being on time');
        $this->patchJson("/api/coordinator/evaluation-criteria/{$id}", ['max_score' => 0])->assertStatus(422);

        // Once an evaluation used it, only the wording can change.
        $deployment = \App\Models\InternshipDeployment::where('school_id', $this->coordinator->school_id)->firstOrFail();
        $evaluation = \App\Models\Evaluation::create([
            'deployment_id' => $deployment->id, 'evaluator_id' => $this->coordinator->id,
            'evaluation_date' => '2026-10-01', 'overall_score' => 80, 'status' => 'submitted',
        ]);
        \App\Models\EvaluationScore::create(['evaluation_id' => $evaluation->id, 'criteria_id' => $id, 'score' => 6]);
        $this->patchJson("/api/coordinator/evaluation-criteria/{$id}", ['max_score' => 9])->assertStatus(422);
        $this->patchJson("/api/coordinator/evaluation-criteria/{$id}", ['name' => 'Punctual'])->assertOk();

        $this->deleteJson("/api/coordinator/evaluation-criteria/{$id}")->assertOk();
        $this->assertDatabaseHas('evaluation_scores', ['evaluation_id' => $evaluation->id, 'criteria_id' => $id]);
        $this->assertDatabaseHas('evaluation_criteria', ['id' => $id, 'status' => 'inactive']);
        $this->getJson('/api/coordinator/evaluation-criteria')->assertOk()
            ->assertJsonMissing(['id' => $id]);
        $this->deleteJson("/api/coordinator/evaluation-criteria/{$id}")->assertStatus(404);
    }

    public function test_criteria_of_another_school_cannot_be_touched(): void
    {
        $other = \App\Models\School::create(['school_code' => 'OTHER-QA', 'school_name' => 'Other College', 'address' => 'Cebu', 'contact_email' => 'o@o.test', 'contact_number' => '09170000008', 'status' => 'active']);
        $foreign = \App\Models\EvaluationCriterion::create(['school_id' => $other->id, 'name' => 'Foreign', 'max_score' => 5, 'weight' => 1, 'status' => 'active']);

        $this->patchJson("/api/coordinator/evaluation-criteria/{$foreign->id}", ['name' => 'Hacked'])->assertStatus(404);
        $this->deleteJson("/api/coordinator/evaluation-criteria/{$foreign->id}")->assertStatus(404);
        $this->assertDatabaseHas('evaluation_criteria', ['id' => $foreign->id, 'name' => 'Foreign', 'status' => 'active']);
    }

    public function test_interns_cannot_be_added_or_imported_to_an_inactive_company(): void
    {
        $this->company->update(['status' => 'inactive']);

        $this->postJson('/api/coordinator/interns', $this->internBody())
            ->assertStatus(422)->assertJsonPath('success', false);
        $this->assertDatabaseMissing('users', ['email' => 'maria.obrien@gmail.com']);

        $this->postJson('/api/coordinator/intern-imports', [
            'company_id' => $this->company->id,
            'start_date' => now('Asia/Manila')->toDateString(),
            'rows' => [['first_name' => 'Ana', 'last_name' => 'Cruz', 'email' => 'ana.cruz.qa@gmail.com', 'course' => 'BSIT', 'year_level' => '4th Year']],
        ])->assertStatus(422);
        $this->assertDatabaseMissing('users', ['email' => 'ana.cruz.qa@gmail.com']);
    }
}
