<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Api\EmailVerificationController;
use App\Mail\InquiryReply;
use App\Mail\SupportTicketNotification;
use App\Models\ActivityLog;
use App\Models\AiUsageLog;
use App\Models\DeanProfile;
use App\Models\PaymentTransaction;
use App\Models\PlanChangeRequest;
use App\Models\PlanInquiry;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolSubscription;
use App\Models\Setting;
use App\Models\SubscriptionPlan;
use App\Models\SupportTicket;
use App\Models\SupportTicketMessage;
use App\Models\User;
use App\Services\AccountInvitationService;
use App\Services\ActivityLogService;
use App\Services\EmailDeliverability;
use App\Services\SchoolStaff;
use App\Services\DefaultEvaluationCriteria;
use App\Services\NarrativeAiService;
use App\Services\NotificationService;
use App\Services\PlanFeatures;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;

class SuperadminFullController extends Controller
{
    public function schools(): JsonResponse
    {
        $schools = School::with(['users.roles', 'coordinatorProfiles.user', 'subscriptions.plan'])
            ->get()
            ->map(function ($school) {
                // admin_* is the school's coordinator; the Dean owns billing and is listed separately.
                $primary = $school->coordinatorProfiles->firstWhere('is_primary_coordinator', true)
                    ?? $school->coordinatorProfiles->first();
                $admin = $primary?->user;
                $dean = $school->users->first(fn ($u) => $u->roles?->name === 'dean');
                // Prefer the active subscription over a newer pending upgrade row, so a
                // school mid-upgrade doesn't misleadingly show as "not active" here.
                $sorted = $school->subscriptions->sortByDesc('id');
                $subscription = $sorted->firstWhere('status', 'active') ?? $sorted->first();
                $accountSetup = $admin && !is_null($admin->password) ? 'active' : 'pending';

                return [
                    'id'          => $school->id,
                    'name'        => $school->school_name ?? 'Unknown School',
                    'admin_name'  => $admin ? trim("{$admin->first_name} {$admin->last_name}") : '—',
                    'admin_email' => $admin?->email,
                    'account_setup' => $accountSetup,
                    'dean_name'     => $dean ? (trim("{$dean->first_name} {$dean->last_name}") ?: $dean->name) : null,
                    'dean_email'    => $dean?->email,
                    'dean_setup'    => SchoolStaff::accountState($dean),
                    'plan'          => $subscription?->plan?->name ?? '—',
                    'billing_period' => $subscription?->billing_period,
                    'amount'        => $subscription?->amount,
                    'payment'       => $subscription?->paid_at ? 'paid' : 'unpaid',
                    'payment_method' => $subscription?->payment_method,
                    'payment_status' => $subscription?->payment_status,
                    'proof_of_payment_url' => $subscription?->proof_of_payment_path
                        ? Storage::url($subscription->proof_of_payment_path)
                        : null,
                    'subscription_status' => $subscription?->effectiveStatus() ?? '—',
                    'offer_expires_at' => $subscription?->offer_expires_at?->format('M d, Y'),
                    'status'        => $subscription?->effectiveStatus() ?? $school->status,
                    'is_suspended'  => (bool) $school->is_suspended,
                    // Only a school that has actually paid gets an expiry date —
                    // a pending offer never shows a fake "valid until" date.
                    'expiry'        => $subscription?->status === 'active'
                        ? ($subscription->end_date?->format('M d, Y') ?? '—')
                        : '—',
                    // Lets the dashboard's "Expiring Soon" widget sort/filter without
                    // re-parsing the formatted `expiry` string above.
                    'days_until_expiry' => ($subscription?->status === 'active' && $subscription->end_date)
                        ? now()->startOfDay()->diffInDays($subscription->end_date->copy()->startOfDay(), false)
                        : null,
                ];
            });

        return response()->json(['schools' => $schools]);
    }

    public function planInquiries(): JsonResponse
    {
        $inquiries = PlanInquiry::orderBy('created_at', 'desc')
            ->get()
            ->map(fn($i) => [
                'id'                    => $i->id,
                'school_name'           => $i->school_name,
                'school_type'           => $i->school_type,
                'address'               => $i->address,
                'contact_person'        => $i->contact_person,
                'position'              => $i->position,
                'email'                 => $i->email,
                'phone'                 => $i->phone,
                'expected_interns'      => $i->intern_range,
                'expected_coordinators' => $i->expected_coordinators,
                'interested_plan'       => $i->interested_plan,
                'heard_from'            => $i->heard_from,
                'message'               => $i->message,
                'status'                => $i->status,
                'notes'                 => $i->notes,
                'school_id'             => $i->school_id,
                'submitted_at'          => $i->created_at?->format('M d, Y · g:i A'),
            ]);

        return response()->json(['inquiries' => $inquiries]);
    }

    /**
     * Public "School Registration + Plan Inquiry" form.
     * Creates a pending Dean user account (login-ready immediately, but with no
     * school/access until Super Admin approves) plus the inquiry/application record. This
     * account becomes the school's Dean (billing owner) once approved.
     */
    public function storeInquiry(Request $request): JsonResponse
    {
        $data = $request->validate([
            'school_name'           => 'required|string|max:255',
            'school_type'           => 'nullable|string|max:255',
            'address'               => 'nullable|string|max:500',
            'website'               => 'nullable|string|max:255',
            'contact_person'        => 'required|string|max:255',
            'position'              => 'nullable|string|max:255',
            'email'                 => ['required', 'email', 'max:255', Rule::unique('users', 'email')],
            'phone'                 => ['required', 'string', 'regex:/^[0-9]{11}$/'],
            'intern_range'          => 'nullable|string|max:50',
            'expected_coordinators' => 'nullable|integer|min:0|max:500',
            'interested_plan'       => 'nullable|string|max:100',
            'heard_from'            => 'nullable|string|max:100',
            'message'               => 'required|string',
            'password'              => 'required|string|min:8|confirmed',
        ]);

        $deanRole = Role::where('name', 'dean')->first();
        if (!$deanRole) {
            return response()->json(['success' => false, 'message' => 'dean role is not configured.'], 500);
        }

        [$inquiry, $user] = DB::transaction(function () use ($data, $deanRole) {
            [$firstName, $lastName] = array_pad(explode(' ', trim($data['contact_person']), 2), 2, '');

            $user = User::create([
                'role_id'    => $deanRole->id,
                'school_id'  => null,
                'name'       => $data['contact_person'],
                'first_name' => $firstName,
                'last_name'  => $lastName,
                'email'      => $data['email'],
                'phone'      => $data['phone'] ?? null,
                'password'   => Hash::make($data['password']),
                'status'     => 'pending_approval',
                // Stays null until they enter the code emailed below — see
                // EmailVerificationController and AuthController::login(),
                // which refuses to sign in an unverified account.
                'email_verified_at' => null,
            ]);

            $inquiry = PlanInquiry::create([
                ...collect($data)->except(['password', 'password_confirmation'])->toArray(),
                'user_id' => $user->id,
                'status'  => 'new',
            ]);

            return [$inquiry, $user];
        });

        EmailVerificationController::sendCode($user);

        NotificationService::toSuperadmin(
            'new_inquiry',
            'New school registration',
            "{$inquiry->school_name} submitted a registration and is waiting for review.",
            '/superadmin/inquiries?highlight=' . $inquiry->id
        );

        ActivityLogService::record(
            module: 'Inquiries',
            action: 'Submitted registration inquiry',
            description: "{$inquiry->school_name} registered and is awaiting review.",
            userId: $inquiry->user_id,
            request: $request
        );

        return response()->json([
            'success' => true,
            'id'      => $inquiry->id,
            'message' => 'Registration received. Check your email for a verification code before logging in — we will also review your request within 1–2 business days.',
        ], 201);
    }

    /**
     * Approve a School Registration: creates the school tenant and links the Dean
     * account that was already created at registration time (no invitation step needed —
     * the applicant already set their own password) as the school's Dean.
     */
    public function convertInquiryToSchool(Request $request, int $id): JsonResponse
    {
        $inquiry = PlanInquiry::with('user')->findOrFail($id);

        if ($inquiry->school_id) {
            return response()->json([
                'success' => false,
                'message' => 'This registration has already been approved.',
            ], 422);
        }

        if (!$inquiry->user) {
            return response()->json([
                'success' => false,
                'message' => 'No account is linked to this registration.',
            ], 422);
        }

        $data = $request->validate([
            'school_name'      => 'required|string|max:150',
            'school_code'      => ['required', 'string', 'max:30', 'regex:/^[A-Z0-9]+(-[A-Z0-9]+)*$/', 'unique:schools,school_code'],
            'address'          => 'nullable|string|max:255',
            'contact_email'    => 'required|email|max:100',
            'contact_number'   => ['nullable', 'string', 'regex:/^[0-9]{11}$/'],
            'plan_name'        => 'required|string|in:Basic,Premium',
            'billing_period'   => 'required|string|in:monthly,yearly',
            'list_price'       => 'required|numeric|min:0',
            'discount_amount'  => 'nullable|numeric|min:0|lte:list_price|decimal:0,2',
            'amount'           => 'required|numeric|min:0',
            'agreement_note'   => [
                Rule::requiredIf(fn () => (float) ($request->discount_amount ?? 0) > 0),
                'nullable', 'string', 'max:500',
            ],
        ], [
            'school_code.regex'    => 'School Code can only use uppercase letters, numbers and single hyphens.',
            'contact_number.regex' => 'Contact Number must be exactly 11 digits.',
            'discount_amount.lte'  => 'Discount cannot be more than the plan price.',
        ]);

        $school = DB::transaction(function () use ($data, $inquiry) {
            $school = School::create([
                'school_code'    => $data['school_code'],
                'school_name'    => $data['school_name'],
                'address'        => $data['address'] ?? null,
                'contact_email'  => $data['contact_email'],
                'contact_number' => $data['contact_number'] ?? null,
                'status'         => 'awaiting_acceptance',
            ]);

            $plan = SubscriptionPlan::where('name', $data['plan_name'])->firstOrFail();

            // start_date/end_date stay null until payment is actually confirmed — a school
            // that hasn't paid yet shouldn't have its subscription year silently ticking down.
            SchoolSubscription::create([
                'school_id'        => $school->id,
                'plan_id'          => $plan->id,
                'status'           => 'awaiting_acceptance',
                'list_price'       => $data['list_price'],
                'discount_amount'  => $data['discount_amount'] ?? 0,
                'amount'           => $data['amount'],
                'agreement_note'   => $data['agreement_note'] ?? null,
                'billing_period'   => $data['billing_period'],
                'offer_sent_at'    => now(),
                'offer_expires_at' => now()->addDays(14),
            ]);

            // An inquiry submitted before the Dean role existed belongs to a coordinator-role
            // account; whoever registered the school is the Dean, so flip it here.
            $inquiry->user->update(['school_id' => $school->id, 'status' => 'active', 'role_id' => SchoolStaff::roleId('dean') ?? $inquiry->user->role_id]);

            DeanProfile::updateOrCreate(
                ['user_id' => $inquiry->user->id],
                ['school_id' => $school->id, 'position' => $inquiry->position ?: 'Dean']
            );

            $inquiry->update(['status' => 'converted', 'school_id' => $school->id]);

            // Every school starts with the real OJT evaluation rubric
            // instead of a blank one — the coordinator can still add or
            // adjust criteria afterward from their own Evaluations screen.
            DefaultEvaluationCriteria::seedFor($school->id);

            return $school;
        });

        NotificationService::send(
            'dean',
            'offer_sent',
            'Your subscription offer is ready',
            "Review your {$data['plan_name']} plan offer and accept it to continue.",
            $school->id,
            $inquiry->user->id,
            '/dean/billing'
        );

        ActivityLogService::record(
            module: 'Schools',
            action: 'Approved registration',
            description: "{$school->school_name} approved with {$data['plan_name']} plan ({$data['billing_period']}).",
            schoolId: $school->id,
            request: $request
        );

        return response()->json([
            'success'   => true,
            'school_id' => $school->id,
            'message'   => "Subscription offer sent to {$inquiry->user->email}. They can log in to review and accept it.",
        ], 201);
    }

    /**
     * Super Admin manually verifies a bank transfer payment after reviewing the uploaded proof.
     */
    public function verifySchoolPayment(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $school->subscriptions()->latest('id')->first();

        if (!$subscription || $subscription->payment_status !== 'pending_verification') {
            return response()->json(['success' => false, 'message' => 'No payment is awaiting verification for this school.'], 422);
        }

        $subscription->activate();
        $school->update(['status' => 'active']);
        $school->subscriptions()->where('status', 'active')->where('id', '!=', $subscription->id)->update(['status' => 'superseded']);

        PaymentTransaction::where('subscription_id', $subscription->id)
            ->update(['status' => 'paid', 'paid_at' => now()]);

        NotificationService::toSchoolDean(
            $school->id,
            'payment_verified',
            'Payment verified',
            "Your bank transfer was verified — {$school->school_name} is now active.",
            '/dean/billing'
        );

        ActivityLogService::record(
            module: 'Payment',
            action: 'Verified bank transfer',
            description: "{$school->school_name}'s payment was verified and the school activated.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => "Payment verified. {$school->school_name} is now active."]);
    }

    /**
     * Manual payment confirmation until a real payment gateway is integrated.
     * Marks the school's current subscription as paid and activates the school.
     */
    public function confirmSchoolPayment(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $school->subscriptions()->latest('id')->first();

        if (!$subscription) {
            return response()->json(['success' => false, 'message' => 'This school has no subscription record.'], 422);
        }

        if ($subscription->status === 'active') {
            return response()->json(['success' => false, 'message' => 'This subscription is already active.'], 422);
        }

        $subscription->activate();
        $school->update(['status' => 'active']);
        $school->subscriptions()->where('status', 'active')->where('id', '!=', $subscription->id)->update(['status' => 'superseded']);

        PaymentTransaction::where('subscription_id', $subscription->id)
            ->update(['status' => 'paid', 'paid_at' => now()]);

        ActivityLogService::record(
            module: 'Payment',
            action: 'Confirmed payment',
            description: "{$school->school_name}'s payment was manually confirmed and the school activated.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => "Payment confirmed. {$school->school_name} is now active."]);
    }

    /**
     * Resets an expired (or still-unanswered) subscription offer with a fresh
     * acceptance window, keeping the same plan/amount unless the Super Admin edits them.
     */
    public function resendSchoolOffer(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $school->subscriptions()->latest('id')->first();

        if (!$subscription) {
            return response()->json(['success' => false, 'message' => 'This school has no subscription to resend.'], 422);
        }

        if (!$subscription->isOfferExpired() && $subscription->status !== 'offer_expired' && $subscription->status !== 'awaiting_acceptance') {
            return response()->json(['success' => false, 'message' => 'This offer is still active or already paid — nothing to resend.'], 422);
        }

        $subscription->update([
            'status'                => 'awaiting_acceptance',
            'offer_sent_at'         => now(),
            'offer_expires_at'      => now()->addDays(14),
            'accepted_at'           => null,
            'payment_method'        => null,
            'payment_status'        => null,
            'payment_reference'     => null,
            'proof_of_payment_path' => null,
        ]);
        $school->update(['status' => 'awaiting_acceptance']);

        NotificationService::toSchoolDean(
            $school->id,
            'offer_resent',
            'New subscription offer',
            "A new subscription offer was sent for {$school->school_name} — accept it to continue.",
            '/dean/billing'
        );

        ActivityLogService::record(
            module: 'Schools',
            action: 'Resent subscription offer',
            description: "A fresh offer was sent to {$school->school_name}.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => "New subscription offer sent to {$school->school_name}."]);
    }

    /**
     * For a school that registered before the Dean role existed (it has a
     * coordinator but nobody owns billing): invites its one Dean with the same
     * "set your own password" link coordinators use for interns.
     */
    public function inviteDean(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);

        $request->merge(['email' => strtolower(str_replace(' ', '', (string) $request->input('email')))]);
        $data = $request->validate([
            'name'     => 'required|string|max:150',
            'email'    => ['required', 'email', 'max:255', Rule::unique('users', 'email')],
            'position' => 'nullable|string|max:100',
        ]);

        if (SchoolStaff::dean($school->id)) {
            return response()->json(['success' => false, 'message' => "{$school->school_name} already has a Dean."], 422);
        }
        if ($problem = EmailDeliverability::problem($data['email'])) {
            return response()->json(['success' => false, 'message' => $problem], 422);
        }

        $deanRole = Role::where('name', 'dean')->first();
        if (!$deanRole) {
            return response()->json(['success' => false, 'message' => 'dean role is not configured.'], 500);
        }

        [$firstName, $lastName] = array_pad(explode(' ', trim($data['name']), 2), 2, '');

        $user = DB::transaction(function () use ($data, $school, $deanRole, $firstName, $lastName) {
            $user = User::create([
                'role_id'    => $deanRole->id,
                'school_id'  => $school->id,
                'name'       => trim($data['name']),
                'first_name' => $firstName,
                'last_name'  => $lastName,
                'email'      => $data['email'],
                'password'   => null,
                'status'     => 'pending_activation',
            ]);

            DeanProfile::create([
                'user_id'   => $user->id,
                'school_id' => $school->id,
                'position'  => $data['position'] ?? 'Dean',
            ]);

            return $user;
        });

        $this->sendDeanInvitation($user, $school);

        ActivityLogService::record(
            module: 'Schools',
            action: 'Invited dean',
            description: "{$user->name} was invited as the Dean of {$school->school_name}.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => "Invitation sent to {$user->email}."], 201);
    }

    /**
     * Re-issues the Dean's invitation while it is still unaccepted; an
     * optional corrected email (e.g. after a bounce) is applied first.
     */
    public function resendDeanInvitation(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $dean = SchoolStaff::dean($school->id);

        if (!$dean) {
            return response()->json(['success' => false, 'message' => "{$school->school_name} has no Dean to re-invite."], 404);
        }
        if ($dean->status !== 'pending_activation') {
            return response()->json(['success' => false, 'message' => 'The Dean has already activated their account.'], 422);
        }

        if ($request->filled('email')) {
            $request->merge(['email' => strtolower(str_replace(' ', '', (string) $request->input('email')))]);
            $data = $request->validate([
                'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($dean->id)],
            ]);
            if ($problem = EmailDeliverability::problem($data['email'])) {
                return response()->json(['success' => false, 'message' => $problem], 422);
            }
            $dean->update(['email' => $data['email'], 'email_bounced_at' => null, 'email_bounce_reason' => null]);
        }

        $this->sendDeanInvitation($dean, $school);

        ActivityLogService::record(
            module: 'Schools',
            action: 'Resent dean invitation',
            description: "The Dean invitation for {$school->school_name} was resent to {$dean->email}.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => "Invitation resent to {$dean->email}."]);
    }

    private function sendDeanInvitation(User $dean, School $school): void
    {
        // Sent on behalf of the platform, not the Super Admin's personal address.
        AccountInvitationService::send($dean, 'Dean', "of {$school->school_name}", 'Internova', config('mail.from.address'));
    }

    /**
     * "Paused" is a flag independent of the school's lifecycle status column —
     * pausing never overwrites it, so restoring never has to guess what the
     * school's underlying status used to be. See School::$fillable comment.
     */
    public function toggleSchoolSuspension(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);

        if ($school->is_suspended) {
            $school->update(['is_suspended' => false, 'suspended_at' => null]);

            NotificationService::toSchoolCoordinators(
                $school->id,
                'access_restored',
                'Access restored',
                "{$school->school_name}'s dashboard access has been restored.",
                '/coordinator/dashboard'
            );
            NotificationService::toSchoolDean(
                $school->id,
                'access_restored',
                'Access restored',
                "{$school->school_name}'s dashboard access has been restored.",
                '/dean/dashboard'
            );
            // Not "important" — this echoes the Super Admin's own action back to
            // themselves, purely so any other open Super Admin tab live-refreshes.
            NotificationService::toSuperadmin('access_restored', 'Access restored', "{$school->school_name} was restored.", '/superadmin/schools?highlight=' . $school->id, important: false);

            ActivityLogService::record(
                module: 'Schools',
                action: 'Restored access',
                description: "{$school->school_name}'s dashboard access was restored.",
                schoolId: $school->id,
                request: $request
            );

            return response()->json(['success' => true, 'message' => "{$school->school_name} access restored.", 'is_suspended' => false]);
        }

        $current = $school->currentSubscription();

        if (!$current || $current->effectiveStatus() !== 'active') {
            return response()->json(['success' => false, 'message' => 'Only schools with an active subscription can be paused.'], 422);
        }

        $school->update(['is_suspended' => true, 'suspended_at' => now()]);

        NotificationService::toSchoolCoordinators(
            $school->id,
            'access_paused',
            'Access paused',
            "{$school->school_name}'s dashboard access has been paused by the Super Admin.",
            '/coordinator/subscription-status'
        );
        NotificationService::toSchoolDean(
            $school->id,
            'access_paused',
            'Access paused',
            "{$school->school_name}'s dashboard access has been paused by the Super Admin.",
            '/dean/billing'
        );
        // Not "important" — see the note on the restore branch above.
        NotificationService::toSuperadmin('access_paused', 'Access paused', "{$school->school_name} was paused.", '/superadmin/schools?highlight=' . $school->id, important: false);

        ActivityLogService::record(
            module: 'Schools',
            action: 'Paused access',
            description: "{$school->school_name}'s dashboard access was paused.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => "{$school->school_name} has been paused.", 'is_suspended' => true]);
    }

    /**
     * Plan changes a coordinator asked for at a non-standard rate — the Super
     * Admin sets the actual terms here (see DeanSubscriptionController::requestPlanChange).
     */
    public function planChangeRequests(): JsonResponse
    {
        $requests = PlanChangeRequest::with('school.subscriptions.plan')
            ->orderByRaw("status = 'pending' desc")
            ->orderByDesc('created_at')
            ->get()
            ->map(function ($r) {
                $currentSubscription = $r->school?->subscriptions->sortByDesc('id')->first();

                return [
                    'id'                        => $r->id,
                    'school_id'                 => $r->school_id,
                    'school_name'               => $r->school?->school_name,
                    'current_plan'              => $currentSubscription?->plan?->name,
                    'current_billing_period'    => $currentSubscription?->billing_period,
                    'requested_plan'            => $r->requested_plan,
                    'requested_billing_period'  => $r->requested_billing_period,
                    'list_price'                => SubscriptionPlan::where('name', $r->requested_plan)->first()?->priceFor($r->requested_billing_period),
                    'note'                      => $r->note,
                    'status'                    => $r->status,
                    'submitted_at'              => $r->created_at?->format('M d, Y · g:i A'),
                ];
            });

        return response()->json(['requests' => $requests]);
    }

    public function approvePlanChange(Request $request, int $id): JsonResponse
    {
        $planChangeRequest = PlanChangeRequest::with('school')->findOrFail($id);

        if ($planChangeRequest->status !== 'pending') {
            return response()->json(['success' => false, 'message' => 'This request was already reviewed.'], 422);
        }

        $data = $request->validate([
            'discount_amount' => 'nullable|numeric|min:0',
            'agreement_note'  => [
                Rule::requiredIf(fn () => (float) ($request->discount_amount ?? 0) > 0),
                'nullable', 'string', 'max:500',
            ],
        ]);

        $school = $planChangeRequest->school;
        $plan = SubscriptionPlan::where('name', $planChangeRequest->requested_plan)->firstOrFail();
        $listPrice = $plan->priceFor($planChangeRequest->requested_billing_period);
        $discount = $data['discount_amount'] ?? 0;
        $amount = max(0, $listPrice - $discount);

        $end = $planChangeRequest->requested_billing_period === 'monthly' ? now()->addMonth() : now()->addYear();
        $previousPayment = $school->subscriptions()->latest('id')->first();

        $newSubscription = $school->subscriptions()->create([
            'plan_id'         => $plan->id,
            'status'          => 'active',
            'list_price'      => $listPrice,
            'discount_amount' => $discount,
            'amount'          => $amount,
            'agreement_note'  => $data['agreement_note'] ?? null,
            'billing_period'  => $planChangeRequest->requested_billing_period,
            'payment_method'  => $previousPayment?->payment_method,
            'payment_status'  => 'paid',
            'paid_at'         => now(),
            'start_date'      => now()->toDateString(),
            'end_date'        => $end->toDateString(),
            'offer_sent_at'   => now(),
            'accepted_at'     => now(),
        ]);

        $school->update(['status' => 'active']);
        $school->subscriptions()->where('status', 'active')->where('id', '!=', $newSubscription->id)->update(['status' => 'superseded']);

        $planChangeRequest->update([
            'status'          => 'approved',
            'discount_amount' => $discount,
            'reviewed_at'     => now(),
        ]);

        NotificationService::toSchoolDean(
            $school->id,
            'plan_change_approved',
            'Plan change approved',
            "You're now on {$planChangeRequest->requested_plan} ({$planChangeRequest->requested_billing_period}).",
            '/dean/billing'
        );

        ActivityLogService::record(
            module: 'Subscription',
            action: 'Approved plan change',
            description: "{$school->school_name} switched to {$planChangeRequest->requested_plan} ({$planChangeRequest->requested_billing_period}).",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => "{$school->school_name} switched to {$planChangeRequest->requested_plan}."]);
    }

    public function rejectPlanChange(Request $request, int $id): JsonResponse
    {
        $planChangeRequest = PlanChangeRequest::findOrFail($id);

        if ($planChangeRequest->status !== 'pending') {
            return response()->json(['success' => false, 'message' => 'This request was already reviewed.'], 422);
        }

        $planChangeRequest->update(['status' => 'rejected', 'reviewed_at' => now()]);

        NotificationService::toSchoolDean(
            $planChangeRequest->school_id,
            'plan_change_rejected',
            'Plan change declined',
            "Your request to switch to {$planChangeRequest->requested_plan} was declined. Contact the Super Admin for details.",
            '/dean/billing'
        );

        ActivityLogService::record(
            module: 'Subscription',
            action: 'Declined plan change',
            description: "Declined the request to switch to {$planChangeRequest->requested_plan}.",
            schoolId: $planChangeRequest->school_id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => 'Plan change request declined.']);
    }

    public function updateInquiry(Request $request, int $id): JsonResponse
    {
        $inquiry = PlanInquiry::findOrFail($id);

        $data = $request->validate([
            'status' => 'sometimes|string|in:new,contacted,under_discussion,approved,converted,rejected',
            'notes'  => 'sometimes|nullable|string|max:2000',
        ]);

        $inquiry->update($data);

        return response()->json(['success' => true]);
    }

    public function sendReply(Request $request): JsonResponse
    {
        $data = $request->validate([
            'inquiry_id' => 'required|exists:plan_inquiries,id',
            'to_email'   => 'required|email',
            'to_name'    => 'required|string',
            'school_name'=> 'required|string',
            'subject'    => 'required|string|max:255',
            'body'       => 'required|string',
        ]);

        Mail::to($data['to_email'], $data['to_name'])->queue(
            new InquiryReply(
                recipientName: $data['to_name'],
                schoolName:    $data['school_name'],
                replySubject:  $data['subject'],
                replyBody:     $data['body'],
                replyToEmail:  $request->user()->email,
                replyToName:   $request->user()->name,
            )
        );

        // Auto-advance status to "contacted" if still "new"
        $inquiry = PlanInquiry::find($data['inquiry_id']);
        if ($inquiry && $inquiry->status === 'new') {
            $inquiry->update(['status' => 'contacted']);
        }

        return response()->json([
            'success' => true,
            'message' => "Email sent to {$data['to_email']}",
        ]);
    }

    public function plansFeatures(): JsonResponse
    {
        $plans = SubscriptionPlan::orderBy('monthly_price')
            ->get()
            ->map(function ($plan) {
                return [
                    'id'             => $plan->id,
                    'name'           => $plan->name,
                    'description'    => $plan->description,
                    'monthly_price'  => (float) $plan->monthly_price,
                    'yearly_price'   => (float) $plan->yearly_price,
                    'features'       => $plan->features ?? [],
                    'is_active'      => $plan->is_active,
                    'active_schools' => SchoolSubscription::where('plan_id', $plan->id)->where('status', 'active')->count(),
                ];
            });

        return response()->json(['plans' => $plans]);
    }

    /**
     * Edits here are the real source of truth for what schools pay from this
     * point forward — existing subscriptions keep whatever amount they already
     * locked in (see SchoolSubscription::activate() and calculateProration()),
     * only new checkouts, upgrades, and plan switches read the updated price.
     */
    public function updatePlan(Request $request, int $id): JsonResponse
    {
        $plan = SubscriptionPlan::findOrFail($id);

        $data = $request->validate([
            'description'   => 'nullable|string|max:500',
            'monthly_price' => 'required|numeric|min:0',
            'yearly_price'  => 'required|numeric|min:0',
            'features'      => 'required|array|min:1',
            'features.*'    => 'string|max:100',
            'is_active'     => 'required|boolean',
        ]);

        $plan->update($data);

        // Not "important" — self-echo purely to live-refresh any other open
        // Super Admin tab, not a genuine alert (the admin editing it already knows).
        NotificationService::toSuperadmin(
            'plan_updated',
            "{$plan->name} plan updated",
            "Pricing or features for the {$plan->name} plan were changed.",
            '/superadmin/plans',
            important: false
        );

        ActivityLogService::record(
            module: 'Plans',
            action: 'Updated plan',
            description: "Pricing or features for the {$plan->name} plan were changed.",
            request: $request
        );

        return response()->json([
            'success' => true,
            'message' => "{$plan->name} plan updated.",
            'plan'    => [
                'id'             => $plan->id,
                'name'           => $plan->name,
                'description'    => $plan->description,
                'monthly_price'  => (float) $plan->monthly_price,
                'yearly_price'   => (float) $plan->yearly_price,
                'features'       => $plan->features ?? [],
                'is_active'      => $plan->is_active,
                'active_schools' => SchoolSubscription::where('plan_id', $plan->id)->where('status', 'active')->count(),
            ],
        ]);
    }

    /**
     * Honest, not aspirational: no AI report/portfolio generation is wired up
     * yet (see AIController), so usage is genuinely zero for every school.
     * What IS real here is which schools are entitled to the feature at all,
     * read straight from their active plan's `features` list.
     */
    /**
     * Real AI usage for the current month, per school: narratives polished by
     * interns and narratives auto-drafted for days they didn't log, from
     * ai_usage_logs. "Live" means a Gemini key is configured on the server.
     */
    public function aiUsage(): JsonResponse
    {
        $monthStart = now()->startOfMonth();

        $counts = AiUsageLog::where('created_at', '>=', $monthStart)
            ->selectRaw('school_id, feature, succeeded, COUNT(*) as total')
            ->groupBy('school_id', 'feature', 'succeeded')
            ->get();

        $countFor = fn ($schoolId, $feature) => (int) $counts
            ->where('school_id', $schoolId)->where('feature', $feature)->where('succeeded', true)->sum('total');

        $schools = School::orderBy('school_name')->get()->map(function ($school) use ($countFor) {
            return [
                'id'             => $school->id,
                'school_name'    => $school->school_name,
                'plan'           => $school->currentSubscription()?->plan?->name,
                'ai_entitled'    => PlanFeatures::has($school, PlanFeatures::AI_FEATURES),
                'polished_count' => $countFor($school->id, AiUsageLog::POLISH),
                'drafted_count'  => $countFor($school->id, AiUsageLog::DRAFT),
            ];
        });

        $succeeded = $counts->where('succeeded', true);

        return response()->json([
            'schools'          => $schools,
            'entitled_schools' => $schools->where('ai_entitled', true)->count(),
            'polished_count'   => (int) $succeeded->where('feature', AiUsageLog::POLISH)->sum('total'),
            'drafted_count'    => (int) $succeeded->where('feature', AiUsageLog::DRAFT)->sum('total'),
            'failed_count'     => (int) $counts->where('succeeded', false)->sum('total'),
            'requests_count'   => (int) $counts->sum('total'),
            'feature_live'     => NarrativeAiService::isConfigured(),
            'model'            => NarrativeAiService::isConfigured() ? NarrativeAiService::model() : null,
            'period_label'     => now()->format('F Y'),
        ]);
    }

    /**
     * Honest, not aspirational: there's no support-ticket submission channel
     * built yet (coordinators have no "Contact Support" flow), so this is
     * always empty today rather than a fabricated sample ticket.
     */
    private function mapSupportTicket(SupportTicket $t): array
    {
        $last = $t->messages->last();

        return [
            'id' => $t->id,
            'school_name' => $t->school?->school_name,
            'coordinator_name' => $t->coordinator?->name,
            'subject' => $t->subject,
            'category' => $t->category,
            'status' => $t->status,
            'last_message' => $last?->message ?: ($last?->attachment_name ? "📎 {$last->attachment_name}" : null),
            'last_message_at' => $last?->created_at?->format('M d, Y g:i A'),
            'created_at' => $t->created_at->format('M d, Y'),
        ];
    }

    private function mapSupportTicketMessage(SupportTicketMessage $m): array
    {
        return [
            'id' => $m->id,
            'sender_name' => $m->sender?->name,
            'is_superadmin' => $m->sender?->role_id == 1,
            'message' => $m->message,
            'attachment_url' => $m->attachment_path ? Storage::disk('public')->url($m->attachment_path) : null,
            'attachment_name' => $m->attachment_name,
            'attachment_type' => $m->attachment_type,
            'attachment_size' => $m->attachment_size,
            'created_at' => $m->created_at->format('M d, Y g:i A'),
        ];
    }

    public function supportMessages(): JsonResponse
    {
        $tickets = SupportTicket::with(['school', 'coordinator', 'messages'])->orderByDesc('updated_at')->get();

        return response()->json([
            'messages' => $tickets->map(fn (SupportTicket $t) => $this->mapSupportTicket($t)),
            'channel_live' => true,
        ]);
    }

    public function supportMessageShow(int $id): JsonResponse
    {
        $ticket = SupportTicket::with(['school', 'coordinator', 'messages.sender'])->find($id);
        if (!$ticket) {
            return response()->json(['success' => false, 'message' => 'Ticket not found.'], 404);
        }

        return response()->json(['ticket' => [
            ...$this->mapSupportTicket($ticket),
            'messages' => $ticket->messages->map(fn (SupportTicketMessage $m) => $this->mapSupportTicketMessage($m)),
        ]]);
    }

    public function supportMessageReply(Request $request, int $id): JsonResponse
    {
        $ticket = SupportTicket::with('coordinator')->find($id);
        if (!$ticket) {
            return response()->json(['success' => false, 'message' => 'Ticket not found.'], 404);
        }

        $data = $request->validate([
            'message' => 'nullable|string|max:3000',
            'attachment' => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf,doc,docx|max:5120',
        ]);

        $attachment = ['attachment_path' => null, 'attachment_name' => null, 'attachment_type' => null, 'attachment_size' => null];
        if ($request->hasFile('attachment')) {
            $file = $request->file('attachment');
            $attachment = [
                'attachment_path' => $file->store("support-attachments/{$request->user()->id}", 'public'),
                'attachment_name' => $file->getClientOriginalName(),
                'attachment_type' => $file->getClientMimeType(),
                'attachment_size' => $file->getSize(),
            ];
        }
        if (empty($data['message']) && !$attachment['attachment_path']) {
            return response()->json(['success' => false, 'message' => 'Write a message or attach a file.'], 422);
        }

        $ticket->messages()->create(['sender_id' => $request->user()->id, 'message' => $data['message'] ?? '', ...$attachment]);
        $ticket->touch();

        // The ticket's owner may be a coordinator or a dean — notify and link by their role.
        $ownerRole = $ticket->coordinator?->roles?->name ?? 'coordinator';

        NotificationService::send(
            audienceRole: $ownerRole,
            type: 'support_ticket_reply',
            title: 'Support replied to your request',
            body: $ticket->subject,
            schoolId: $ticket->school_id,
            userId: $ticket->coordinator_id,
            link: "/{$ownerRole}/support"
        );

        if ($ticket->coordinator?->email) {
            Mail::to($ticket->coordinator->email, $ticket->coordinator->name)->queue(new SupportTicketNotification(
                recipientName: $ticket->coordinator->name,
                senderLabel: $request->user()->name . ' (Internova Support)',
                ticketSubject: $ticket->subject,
                messageBody: $data['message'] ?? '(attachment only)',
                hasAttachment: (bool) $attachment['attachment_path'],
                ticketUrl: config('app.frontend_url') . "/{$ownerRole}/support",
            ));
        }

        return response()->json(['success' => true]);
    }

    public function supportMessageUpdateStatus(Request $request, int $id): JsonResponse
    {
        $ticket = SupportTicket::find($id);
        if (!$ticket) {
            return response()->json(['success' => false, 'message' => 'Ticket not found.'], 404);
        }

        $data = $request->validate(['status' => 'required|string|in:Open,Resolved']);
        $ticket->update(['status' => $data['status']]);

        return response()->json(['success' => true]);
    }

    /**
     * Real audit trail — every row here comes from ActivityLogService::record()
     * calls placed alongside the actions that actually change something
     * (payments, approvals, suspensions, plan edits...), not synthetic data.
     */
    /**
     * Logs for one school (or, with school_id=none, the system/superadmin-only
     * bucket) at a time — the Activity screen calls this once per school
     * section rather than one global feed, so each school's history loads
     * and paginates independently instead of interleaving into a single
     * scroll a superadmin has to hunt through.
     */
    public function activityLogs(Request $request): JsonResponse
    {
        $data = $request->validate([
            'module'    => 'nullable|string',
            'page'      => 'nullable|integer|min:1',
            'school_id' => 'nullable|string',
        ]);

        $perPage = 10;
        $page = $data['page'] ?? 1;

        $query = ActivityLog::with(['user', 'school'])->latest('id');
        if (!empty($data['module']) && $data['module'] !== 'All') {
            $query->where('module', $data['module']);
        }
        if (!empty($data['school_id'])) {
            if ($data['school_id'] === 'none') {
                $query->whereNull('school_id');
            } else {
                $query->where('school_id', (int) $data['school_id']);
            }
        }

        $total = (clone $query)->count();
        $logs = $query->forPage($page, $perPage)->get();

        return response()->json([
            'logs' => $logs->map(fn ($log) => [
                'id'          => $log->id,
                'timestamp'   => $log->created_at->format('M d, Y \a\t g:i A'),
                'user'        => $log->user?->name ?? 'System',
                'school'      => $log->school?->school_name,
                'module'      => $log->module,
                'action'      => $log->action,
                'description' => $log->description,
            ]),
            'page'     => $page,
            'per_page' => $perPage,
            'total'    => $total,
            'has_more' => $page * $perPage < $total,
        ]);
    }

    /**
     * The Activity screen's starting point — which schools have logged
     * activity at all (plus the system/superadmin-only bucket) and how many
     * entries each has, so it can render one section per school and let
     * activityLogs() above fill each in on demand.
     */
    public function activityLogSchools(Request $request): JsonResponse
    {
        $data = $request->validate(['module' => 'nullable|string']);
        $hasModuleFilter = !empty($data['module']) && $data['module'] !== 'All';

        $schoolCounts = ActivityLog::whereNotNull('school_id')
            ->when($hasModuleFilter, fn ($q) => $q->where('module', $data['module']))
            ->selectRaw('school_id, count(*) as total')
            ->groupBy('school_id')
            ->orderByDesc('total')
            ->get()
            ->map(fn ($row) => [
                'id'    => $row->school_id,
                'name'  => School::find($row->school_id)?->school_name ?? 'Unknown school',
                'total' => (int) $row->total,
            ]);

        $systemTotal = ActivityLog::whereNull('school_id')
            ->when($hasModuleFilter, fn ($q) => $q->where('module', $data['module']))
            ->count();

        return response()->json([
            'schools'      => $schoolCounts,
            'system_total' => $systemTotal,
            'modules'      => ActivityLog::query()->select('module')->distinct()->orderBy('module')->pluck('module'),
        ]);
    }

    public function systemSettings(): JsonResponse
    {
        return response()->json([
            'settings' => Setting::orderBy('id')->get()->map(fn ($s) => [
                'key'         => $s->key,
                'name'        => $s->name,
                'description' => $s->description,
                'type'        => $s->type,
                'value'       => $s->type === 'toggle' ? (bool) $s->value : $s->value,
            ]),
        ]);
    }

    /**
     * Every setting here genuinely persists — no fake "Save" button. Only
     * `maintenance_mode` is called out to the admin as not yet enforced
     * platform-wide (see the frontend), since wiring it to Laravel's real
     * `artisan down` would need a bypass path for this same settings screen
     * or the admin could lock themselves out with no way back in through the UI.
     */
    public function updateSystemSetting(Request $request, string $key): JsonResponse
    {
        $setting = Setting::where('key', $key)->firstOrFail();

        $data = $request->validate([
            'value' => $setting->type === 'toggle' ? 'required|boolean' : 'required|string|max:255',
        ]);

        $setting->update(['value' => $setting->type === 'toggle' ? ($data['value'] ? '1' : '0') : $data['value']]);

        ActivityLogService::record(
            module: 'Settings',
            action: "Updated {$setting->name}",
            description: $setting->type === 'toggle'
                ? ($data['value'] ? "{$setting->name} turned on." : "{$setting->name} turned off.")
                : "{$setting->name} set to \"{$data['value']}\".",
            request: $request
        );

        return response()->json([
            'success' => true,
            'message' => "{$setting->name} updated.",
            'setting' => [
                'key'         => $setting->key,
                'name'        => $setting->name,
                'description' => $setting->description,
                'type'        => $setting->type,
                'value'       => $setting->type === 'toggle' ? (bool) $setting->value : $setting->value,
            ],
        ]);
    }
}
