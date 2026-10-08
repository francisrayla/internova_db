<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\InternshipDeployment;
use App\Models\Notification;
use App\Models\User;
use App\Support\LocalTime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class LocalTimeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(\Database\Seeders\InternovaSeeder::class);
        Storage::fake('public');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function intern(): User
    {
        $u = User::where('email', 'intern@internova.test')->first();
        $d = InternshipDeployment::where('intern_id', $u->id)->first();
        Attendance::where('deployment_id', $d->id)->delete();

        return $u;
    }

    private function clockIn(string $utcNow)
    {
        Carbon::setTestNow(Carbon::parse($utcNow, 'UTC'));
        Sanctum::actingAs($this->intern());

        return $this->post('/api/intern/attendance/clock-in', [
            'selfie' => UploadedFile::fake()->create('s.jpg', 10, 'image/jpeg'),
            'latitude' => 14.5547, 'longitude' => 121.0244,
        ], ['Accept' => 'application/json']);
    }

    public function test_helpers_use_manila_day(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-05 17:00:00', 'UTC'));
        $this->assertSame('2026-10-06', LocalTime::today());
        $this->assertSame('01:00 AM', LocalTime::time(now()));
        $this->assertSame('2026-10-06', LocalTime::todayDate()->toDateString());
        [$s, $e] = LocalTime::dayBounds('2026-10-06');
        $this->assertSame('2026-10-05 16:00:00', $s->format('Y-m-d H:i:s'));
        $this->assertSame('2026-10-06 15:59:59', $e->format('Y-m-d H:i:s'));
    }

    public function test_clock_in_just_after_midnight_utc_shows_manila_time_and_same_date(): void
    {
        $res = $this->clockIn('2026-10-06 00:01:00');
        $res->assertOk()->assertJsonPath('record.clock_in', '08:01 AM');
        $row = Attendance::first();
        $this->assertSame('2026-10-06', $row->attendance_date->toDateString());
        $this->assertSame('2026-10-06 00:01:00', $row->getRawOriginal('clock_in'));
    }

    public function test_clock_in_late_evening_utc_belongs_to_next_manila_day(): void
    {
        $res = $this->clockIn('2026-10-05 17:00:00');
        $res->assertOk()->assertJsonPath('record.clock_in', '01:00 AM');
        $this->assertSame('2026-10-06', Attendance::first()->attendance_date->toDateString());
        // Same Manila day: today's record is found, so the next action is clock out.
        $this->getJson('/api/intern/attendance/today')->assertOk()->assertJsonPath('next_action', 'clock_out');
    }

    public function test_attendance_today_day_end_carries_offset(): void
    {
        $this->clockIn('2026-10-05 17:00:00');
        $end = $this->getJson('/api/intern/attendance/today')->json('day_ends_at');
        $this->assertStringContainsString('+08:00', $end);
        $this->assertSame('2026-10-06 23:59:59', Carbon::parse($end)->format('Y-m-d H:i:s'));
    }

    public function test_offline_clock_in_uses_device_offset_and_manila_date(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-05 17:30:00', 'UTC'));
        Sanctum::actingAs($this->intern());
        $this->post('/api/intern/attendance/clock-in', [
            'is_offline' => 1,
            'device_time' => '2026-10-06T01:00:00+08:00',
            'device_now' => '2026-10-06T01:30:00+08:00',
            'selfie' => UploadedFile::fake()->create('s.jpg', 10, 'image/jpeg'), 'latitude' => 14.5547, 'longitude' => 121.0244,
        ], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('record.clock_in', '01:00 AM');
        $row = Attendance::first();
        $this->assertSame('2026-10-05 17:00:00', $row->getRawOriginal('clock_in'));
        $this->assertSame('2026-10-06', $row->attendance_date->toDateString());
    }

    public function test_activity_date_defaults_to_manila_today(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-05 18:00:00', 'UTC'));
        Sanctum::actingAs($this->intern());
        $this->postJson('/api/intern/activities', ['title' => 'Filing', 'description' => 'Filed records for the day.'])
            ->assertOk()->assertJsonPath('activity.activity_date_raw', '2026-10-06');
    }

    public function test_notification_and_message_timestamps_are_manila(): void
    {
        $u = $this->intern();
        $n = Notification::create(['audience_role' => 'intern', 'user_id' => $u->id, 'school_id' => $u->school_id, 'type' => 'x', 'title' => 'T', 'body' => 'M', 'link' => '/x']);
        $n->forceFill(['created_at' => '2026-10-06 00:01:00'])->saveQuietly();
        Sanctum::actingAs($u);
        $this->getJson('/api/notifications?audience_role=intern&user_id=' . $u->id . '&school_id=' . $u->school_id)->assertOk()
            ->assertJsonPath('notifications.0.created_at', 'October 06, 2026 at 8:01 AM');
    }
}
