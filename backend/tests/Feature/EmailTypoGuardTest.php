<?php

namespace Tests\Feature;

use App\Models\School;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The public registration form and the Dean's school contact e-mail use the same CompleteEmail
 * rule as the invite forms: typos such as gmial.com are refused with "Did you mean ...?".
 */
class EmailTypoGuardTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
    }

    private function registration(string $email): array
    {
        return [
            'school_name' => 'Typo College', 'contact_person' => 'Pat Dean', 'position' => 'Dean',
            'email' => $email, 'phone' => '09171234567', 'message' => 'Hello',
            'password' => 'password123', 'password_confirmation' => 'password123', 'accept_terms' => true,
        ];
    }

    public function test_registration_refuses_typo_and_incomplete_addresses(): void
    {
        $this->postJson('/api/inquiries', $this->registration('pat@gmial.com'))
            ->assertStatus(422)->assertJsonPath('errors.email.0', 'Did you mean pat@gmail.com?');
        $this->postJson('/api/inquiries', $this->registration('dean@gmail'))->assertStatus(422)->assertJsonValidationErrors('email');
        $this->postJson('/api/inquiries', $this->registration('dean@localhost'))->assertStatus(422)->assertJsonValidationErrors('email');
        $this->assertSame(0, User::where('email', 'like', '%gmial%')->count());
    }

    public function test_registration_accepts_good_addresses_and_saves_them_lowercase(): void
    {
        $this->postJson('/api/inquiries', $this->registration('  Pat.Dean@Gmail.com '))->assertCreated();
        $this->assertNotNull(User::where('email', 'pat.dean@gmail.com')->first());
    }

    public function test_school_contact_email_in_dean_settings_refuses_typos(): void
    {
        $dean = User::where('email', 'dean@internova.test')->firstOrFail();
        Sanctum::actingAs($dean);
        $payload = ['school_name' => 'Renamed College', 'address' => 'Pasig', 'contact_number' => '09175550000'];

        $this->patchJson('/api/dean/school-settings', $payload + ['contact_email' => 'info@gmial.com'])
            ->assertStatus(422)->assertJsonPath('errors.contact_email.0', 'Did you mean info@gmail.com?');
        $this->patchJson('/api/dean/school-settings', $payload + ['contact_email' => 'info@localhost'])->assertStatus(422);
        $this->patchJson('/api/dean/school-settings', $payload + ['contact_email' => 'dean@gmail'])->assertStatus(422);

        $this->patchJson('/api/dean/school-settings', $payload + ['contact_email' => 'Info@Gmail.com'])->assertOk();
        $this->assertSame('info@gmail.com', School::find($dean->school_id)->contact_email);
    }

    public function test_an_address_saved_earlier_stays_accepted_when_it_is_not_changed(): void
    {
        $dean = User::where('email', 'dean@internova.test')->firstOrFail();
        School::whereKey($dean->school_id)->update(['contact_email' => 'old@abctech.edu']);
        Sanctum::actingAs($dean);

        $this->patchJson('/api/dean/school-settings', [
            'school_name' => 'Renamed College', 'address' => 'Pasig', 'contact_number' => '09175550000', 'contact_email' => 'old@abctech.edu',
        ])->assertOk();
    }
}
