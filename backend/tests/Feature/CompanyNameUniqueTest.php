<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Two companies of one school never share a name (the company pickers would be ambiguous). */
class CompanyNameUniqueTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private User $coordinator;
    private Company $existing;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        $this->coordinator = User::where('email', 'coordinator@internova.test')->firstOrFail();
        $this->existing = Company::where('school_id', $this->coordinator->school_id)->firstOrFail();
        Sanctum::actingAs($this->coordinator);
    }

    private function other(string $name): Company
    {
        return Company::create(['school_id' => $this->coordinator->school_id, 'company_code' => 'CMP-' . strtoupper(substr(md5($name), 0, 6)), 'company_name' => $name, 'status' => 'active']);
    }

    public function test_add_refuses_the_same_name_ignoring_case_and_spacing(): void
    {
        $count = Company::count();
        $name = $this->existing->company_name;
        foreach ([$name, strtoupper($name), '  ' . str_replace(' ', '   ', $name) . ' '] as $try) {
            $res = $this->postJson('/api/coordinator/companies', ['company_name' => $try])->assertStatus(422);
            $this->assertStringContainsString('already exists in your school', $res->json('message'));
            $this->assertArrayHasKey('company_name', $res->json('errors'));
        }
        $this->assertSame($count, Company::count());
    }

    public function test_add_allows_a_different_name_and_the_same_name_in_another_school(): void
    {
        $this->postJson('/api/coordinator/companies', ['company_name' => 'Brand New Corp'])->assertOk();
        $this->postJson('/api/coordinator/companies', ['company_name' => $this->existing->company_name . ' Branch 2'])->assertOk();

        $other = $this->makeOtherSchool('dup');
        Company::where('school_id', $other['school']->id)->update(['company_name' => 'Shared Name Inc']);
        $this->postJson('/api/coordinator/companies', ['company_name' => 'Shared Name Inc'])->assertOk();
    }

    public function test_rename_refuses_another_companys_name_but_not_its_own(): void
    {
        $b = $this->other('Second Co');

        $res = $this->patchJson("/api/coordinator/companies/{$b->id}", ['company_name' => '  ' . strtolower($this->existing->company_name)])->assertStatus(422);
        $this->assertStringContainsString('already exists in your school', $res->json('message'));
        $this->assertSame('Second Co', $b->fresh()->company_name);

        // Changing only the case or spacing of its own name, or other details, is fine.
        $this->patchJson("/api/coordinator/companies/{$b->id}", ['company_name' => 'SECOND  CO'])->assertOk();
        $this->patchJson("/api/coordinator/companies/{$b->id}", ['company_name' => 'SECOND  CO', 'address' => 'Somewhere'])->assertOk();
        $this->patchJson("/api/coordinator/companies/{$b->id}", ['status' => 'inactive'])->assertOk();
    }

    public function test_an_older_duplicate_does_not_block_editing_other_details(): void
    {
        $dup = $this->other($this->existing->company_name);

        $this->patchJson("/api/coordinator/companies/{$dup->id}", ['company_name' => $dup->company_name, 'address' => 'New street'])->assertOk();
        $this->assertSame('New street', $dup->fresh()->address);
    }
}
