<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Company;
use App\Models\SupervisorProfile;
use App\Services\ActivityLogService;
use App\Services\NotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The company's map pin and attendance radius. ONLY a supervisor of the company sets it (standing at the
 * company with "Use my current location"); the coordinator and the Dean see it read-only. An intern outside the
 * circle is flagged for review (Attendance 'outside_area'), never blocked.
 *
 * There is no company id in the URL: a supervisor can only ever reach their own company, so another company or
 * school cannot be addressed at all.
 */
class SupervisorCompanyLocationController extends Controller
{
    /** A fix rougher than this (metres) is refused so a bad pin is not saved. */
    public const MAX_ACCURACY_M = 100;

    private function companyFor(Request $request): ?Company
    {
        return SupervisorProfile::with('company.locationSetter')
            ->where('user_id', $request->user()->id)
            ->where('school_id', $request->user()->school_id)
            ->first()?->company;
    }

    public function show(Request $request): JsonResponse
    {
        $company = $this->companyFor($request);
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Supervisor profile not found.'], 404);
        }

        return response()->json([
            'success' => true,
            'company' => ['id' => $company->id, 'name' => $company->company_name, 'address' => $company->address],
            'location' => $company->locationPayload(),
            'limits' => ['default_radius' => Company::DEFAULT_RADIUS_M, 'min_radius' => Company::MIN_RADIUS_M, 'max_radius' => Company::MAX_RADIUS_M, 'max_accuracy' => self::MAX_ACCURACY_M],
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'latitude' => 'required|numeric|between:-90,90',
            'longitude' => 'required|numeric|between:-180,180',
            'accuracy_m' => 'nullable|numeric|min:0|max:5000',
            'allowed_radius_meters' => 'nullable|integer|min:' . Company::MIN_RADIUS_M . '|max:' . Company::MAX_RADIUS_M,
        ], [
            'allowed_radius_meters.min' => 'The radius must be at least ' . Company::MIN_RADIUS_M . ' m.',
            'allowed_radius_meters.max' => 'The radius can be at most ' . Company::MAX_RADIUS_M . ' m.',
        ]);

        $company = $this->companyFor($request);
        if (!$company) {
            return response()->json(['success' => false, 'message' => 'Supervisor profile not found.'], 404);
        }

        if (isset($data['accuracy_m']) && (float) $data['accuracy_m'] > self::MAX_ACCURACY_M) {
            $message = 'Your GPS reading is too rough (±' . (int) round((float) $data['accuracy_m']) . ' m). Step outside or wait a moment, then try again.';

            return response()->json(['success' => false, 'message' => $message, 'errors' => ['accuracy_m' => [$message]]], 422);
        }

        $radius = (int) ($data['allowed_radius_meters'] ?? $company->allowed_radius_meters ?: Company::DEFAULT_RADIUS_M);
        $wasSet = $company->hasLocation();
        $moved = !$wasSet
            || abs((float) $company->latitude - (float) $data['latitude']) > 0.0000005
            || abs((float) $company->longitude - (float) $data['longitude']) > 0.0000005;
        $changed = $moved || (int) $company->allowed_radius_meters !== $radius;

        $company->forceFill([
            'latitude' => round((float) $data['latitude'], 7),
            'longitude' => round((float) $data['longitude'], 7),
            'allowed_radius_meters' => $radius,
            'location_set_by' => $request->user()->id,
            'location_set_at' => now(),
        ])->save();
        $company->load('locationSetter');

        $who = $request->user()->name;
        $what = $wasSet ? 'changed' : 'set';
        ActivityLogService::record(
            module: 'Companies',
            action: $wasSet ? 'Changed company location' : 'Set company location',
            description: "{$who} {$what} the attendance location of {$company->company_name} (radius {$radius} m).",
            schoolId: $company->school_id,
            request: $request
        );

        // Tell the other supervisors of the company and the school's coordinator, once per real change.
        if ($changed) {
            $title = $wasSet ? 'Company location changed' : 'Company location set';
            $body = "{$who} {$what} {$company->company_name}'s attendance location (radius {$radius} m). Interns outside the circle are flagged for review.";
            rescue(function () use ($company, $request, $title, $body) {
                SupervisorProfile::where('company_id', $company->id)
                    ->where('user_id', '!=', $request->user()->id)
                    ->whereHas('user', fn ($q) => $q->where('status', 'active'))
                    ->pluck('user_id')->unique()
                    ->each(fn ($userId) => NotificationService::toUser('supervisor', $userId, $company->school_id, 'company_location', $title, $body, '/supervisor/settings/location'));
                NotificationService::toSchoolCoordinators($company->school_id, 'company_location', $title, $body, "/coordinator/companies/{$company->id}");
            });
        }

        return response()->json([
            'success' => true,
            'message' => 'Company location saved.',
            'location' => $company->locationPayload(),
        ]);
    }
}
