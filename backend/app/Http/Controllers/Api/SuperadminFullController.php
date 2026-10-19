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
use App\Services\PayMongoService;
use App\Services\PaymentActivation;
use App\Services\PlanFeatures;
use App\Support\Paging;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;
use App\Support\HeadTitle as HT;

class SuperadminFullController extends Controller
{
    /** The "needs attention" queue for the Super Admin dashboard (see DashboardQueueService::superAdmin). */
    public function dashboard(): JsonResponse
    {
        return response()->json(['queue' => \App\Services\DashboardQueueService::superAdmin()]);
    }

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
                $sorted = $school->subscriptions->where('status', '!=', 'scheduled')->sortByDesc('id');
                $subscription = $sorted->firstWhere('status', 'active') ?? $sorted->first();
                $accountSetup = $admin && !is_null($admin->password) ? 'active' : 'pending';

                return [
                    'id'          => $school->id,
                    'name'        => $school->school_name ?? 'Unknown School',
                    'admin_name'  => $admin ? trim("{$admin->first_name} {$admin->last_name}") : '—',
                    'admin_email' => $admin?->email,
                    'account_setup' => $accountSetup,
                    'dean_name'     => $dean ? (trim("{$dean->first_name} {$dean->last_name}") ?: $dean->name) : null,
                    'dean_title'    => $dean ? \App\Support\HeadTitle::forDean($dean) : null,
                    'dean_email'    => $dean?->email,
                    'dean_setup'    => SchoolStaff::accountState($dean),
                    'plan'          => $subscription?->plan?->name ?? '—',
                    'billing_period' => $subscription?->billing_period,
                    'amount'        => $subscription?->amount,
                    'scheduled_switch' => \App\Services\SubscriptionRollover::summary($school->subscriptions->firstWhere('status', 'scheduled')),
                    'breakdown'     => $subscription ? \App\Services\SubscriptionBreakdown::forSubscription($subscription) : null,
                    'awaiting_payment_change' => $this->awaitingChange($school, $subscription),
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

    /** An approved plan change (offer row newer than the active plan) that is still unpaid. */
    private function awaitingChange($school, $active): ?array
    {
        if (!$active || $active->status !== 'active') {
            return null;
        }

        $row = $school->subscriptions
            ->where('id', '>', $active->id)
            ->whereIn('status', ['accepted', 'pending_payment'])
            ->sortByDesc('id')
            ->first();

        if (!$row) {
            return null;
        }

        return [
            'id'             => $row->id,
            'plan'           => $row->plan?->name,
            'billing_period' => $row->billing_period,
            'amount'         => (float) $row->amount,
            'status'         => $row->status,
            'payment_status' => $row->payment_status,
            'payment_method' => $row->payment_method,
            'waived'         => (float) $row->amount <= 0,
            'proof_of_payment_url' => $row->proof_of_payment_path ? Storage::url($row->proof_of_payment_path) : null,
            'breakdown'      => \App\Services\SubscriptionBreakdown::forSubscription($row),
        ];
    }

    public function planInquiries(Request $request): JsonResponse
    {
        $query = PlanInquiry::orderBy('created_at', 'desc')->orderByDesc('id');
        $map = fn ($i) => [
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
            'submitted_at'          => $i->created_at?->local()?->format('M d, Y · g:i A'),
        ];

        // Opt-in paging: `statuses` (comma list) narrows the whole set first, `counts` always covers every inquiry.
        if (Paging::requested($request)) {
            if ($statuses = array_filter(explode(',', (string) $request->query('statuses')))) {
                $query->whereIn('status', $statuses);
            }
            $page = $query->paginate(Paging::perPage($request, 15, 50));

            return response()->json([
                'inquiries' => collect($page->items())->map($map)->values(),
                ...Paging::meta($page),
                'counts' => PlanInquiry::selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status'),
            ]);
        }

        return response()->json(['inquiries' => $query->get()->map($map)]);
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
            'school_name'           => ['required', 'string', 'max:255', 'regex:' . \App\Support\TextRules::ORG_NAME],
            'school_type'           => 'nullable|string|max:255',
            'address'               => 'nullable|string|max:500',
            'website'               => 'nullable|string|max:255',
            'contact_person'        => ['required', 'string', 'max:255', 'regex:' . \App\Support\TextRules::PERSON_NAME],
            'position'              => ['nullable', 'string', Rule::in(\App\Support\HeadTitle::OPTIONS)],
            'email'                 => ['required', 'email', 'max:255', Rule::unique('users', 'email')],
            'phone'                 => ['required', 'string', 'regex:/^[0-9]{11}$/'],
            'intern_range'          => 'nullable|string|max:50',
            'expected_coordinators' => 'nullable|integer|min:0|max:500',
            'interested_plan'       => 'nullable|string|max:100',
            'heard_from'            => 'nullable|string|max:100',
            'message'               => 'required|string',
            'password'              => 'required|string|min:8|confirmed',
            'accept_terms'          => 'accepted',
        ], [
            'accept_terms.accepted' => 'You need to agree to the Terms and Conditions and the Privacy Notice to register.',
            'school_name.regex' => 'School name: ' . \App\Support\TextRules::ORG_NAME_MESSAGE,
            'contact_person.regex' => 'Full name: ' . \App\Support\TextRules::PERSON_NAME_MESSAGE,
        ]);

        $deanRole = Role::where('name', 'dean')->first();
        if (!$deanRole) {
            return response()->json(['success' => false, 'message' => 'dean role is not configured.'], 500);
        }

        [$inquiry, $user] = DB::transaction(function () use ($data, $deanRole) {
            $termsAt = now();
            $termsVersion = config('internova.terms_version');

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
                'terms_accepted_at' => $termsAt,
                'terms_version'     => $termsVersion,
                // Stays null until they enter the code emailed below — see
                // EmailVerificationController and AuthController::login(),
                // which refuses to sign in an unverified account.
                'email_verified_at' => null,
            ]);

            $inquiry = PlanInquiry::create([
                ...collect($data)->except(['password', 'password_confirmation', 'accept_terms'])->toArray(),
                'user_id' => $user->id,
                'status'  => 'new',
                'terms_accepted_at' => $termsAt,
                'terms_version'     => $termsVersion,
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
            'school_name'      => ['required', 'string', 'max:150', 'regex:' . \App\Support\TextRules::ORG_NAME],
            'school_code'      => ['required', 'string', 'max:30', 'regex:/^[A-Z0-9]+(-[A-Z0-9]+)*$/', 'unique:schools,school_code'],
            'address'          => 'nullable|string|max:255',
            'contact_email'    => 'required|email|max:100',
            'contact_number'   => ['nullable', 'string', 'regex:/^[0-9]{11}$/'],
            'plan_name'        => 'required|string|in:Basic,Premium',
            'billing_period'   => 'required|string|in:monthly,yearly',
            'list_price'       => 'required|numeric|min:0|max:9999999.99',
            'discount_amount'  => 'nullable|numeric|min:0|lte:list_price|decimal:0,2',
            'amount'           => 'required|numeric|min:0|max:9999999.99',
            'agreement_note'   => [
                Rule::requiredIf(fn () => (float) ($request->discount_amount ?? 0) > 0),
                'nullable', 'string', 'max:500',
            ],
        ], [
            'school_code.regex'    => 'School Code can only use uppercase letters, numbers and single hyphens.',
            'school_name.regex'    => 'School name: ' . \App\Support\TextRules::ORG_NAME_MESSAGE,
            'contact_number.regex' => 'Contact Number must be exactly 11 digits.',
            'discount_amount.lte'  => 'Discount cannot be more than the plan price.',
        ]);

        // The offer must be the price list minus the stated discount: the form only displays the sum,
        // the server does not trust it (a tampered request could otherwise offer a school for 1 peso).
        $plan = SubscriptionPlan::where('name', $data['plan_name'])->firstOrFail();
        $planPrice = round((float) ($data['billing_period'] === 'yearly' ? $plan->yearly_price : $plan->monthly_price), 2);
        $discount = round((float) ($data['discount_amount'] ?? 0), 2);
        if (abs((float) $data['list_price'] - $planPrice) > 0.005 || abs((float) $data['amount'] - ($planPrice - $discount)) > 0.005) {
            return response()->json([
                'success' => false,
                'message' => 'The amount does not match the plan price minus the discount. Reload the page and try again.',
            ], 422);
        }

        $school = DB::transaction(function () use ($data, $inquiry, $plan) {
            $school = School::create([
                'school_code'    => $data['school_code'],
                'school_name'    => $data['school_name'],
                'address'        => $data['address'] ?? null,
                'contact_email'  => $data['contact_email'],
                'contact_number' => $data['contact_number'] ?? null,
                'status'         => 'awaiting_acceptance',
            ]);

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
            $inquiry->user->update([
                'school_id' => $school->id,
                'status' => 'active',
                'role_id' => SchoolStaff::roleId('dean') ?? $inquiry->user->role_id,
                // The Dean agreed on the registration form; carry that over (never overwrite a newer one).
                'terms_accepted_at' => $inquiry->user->terms_accepted_at ?? $inquiry->terms_accepted_at,
                'terms_version' => $inquiry->user->terms_version ?? $inquiry->terms_version,
            ]);

            DeanProfile::updateOrCreate(
                ['user_id' => $inquiry->user->id],
                ['school_id' => $school->id, 'position' => \App\Support\HeadTitle::normalize($inquiry->position)]
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

        // The head may not log in for days; the offer also goes out by email.
        \App\Services\BillingMailer::sendOffer($school, $school->subscriptions()->latest('id')->first(), [$inquiry->user->fresh()]);

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

    /** Server-side revenue figures from real paid transactions (see RevenueReportService). */
    public function revenue(\App\Services\RevenueReportService $service): JsonResponse
    {
        return response()->json($service->report());
    }

    /**
     * Super Admin manually verifies a bank transfer payment after reviewing the uploaded proof.
     * Goes through PaymentActivation, so verifying twice (double click, two admins) activates once.
     */
    public function verifySchoolPayment(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $school->latestBillableSubscription();

        if (!$subscription || $subscription->payment_status !== 'pending_verification') {
            return response()->json(['success' => false, 'message' => 'No payment is awaiting verification for this school.'], 422);
        }

        $outcome = PaymentActivation::activate($subscription);

        if ($outcome['result'] !== PaymentActivation::ACTIVATED) {
            return response()->json(['success' => false, 'message' => 'No payment is awaiting verification for this school.'], 422);
        }

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
            description: "{$school->school_name}'s payment of " . number_format((float) $subscription->amount, 2) . ' was verified and the school activated.',
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => "Payment verified. {$school->school_name} is now active."]);
    }

    /**
     * Manual payment confirmation (override) for money received outside the gateway,
     * or a plan with nothing to pay. Marks the school's current subscription as paid
     * and activates it. Always written to the audit log with who did it, what state
     * it overrode and the optional note, because it activates a school without the
     * gateway proving the payment. Open PayMongo checkouts for the same invoice are
     * closed so the school cannot pay twice.
     */
    public function confirmSchoolPayment(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $data = $request->validate(['note' => 'nullable|string|max:300']);

        return DB::transaction(function () use ($request, $school, $data) {
            School::whereKey($school->id)->lockForUpdate()->first();
            $subscription = $school->subscriptions()->where('status', '!=', 'scheduled')->latest('id')->lockForUpdate()->first();

            if (!$subscription) {
                return response()->json(['success' => false, 'message' => 'This school has no subscription record.'], 422);
            }

            if ($subscription->status === 'active') {
                $message = $subscription->isRenewalExpired()
                    ? "This school's subscription has expired. Ask the " . HT::forSchool($school->id) . " to start the renewal from Billing, then confirm the payment."
                    : 'This subscription is already active.';

                return response()->json(['success' => false, 'message' => $message], 422);
            }

            $before = "{$subscription->status}/" . ($subscription->payment_status ?? 'none');
            $waived = (float) $subscription->amount <= 0;

            // An open online checkout would let the school pay again after this override.
            $openOnline = PaymentTransaction::where('subscription_id', $subscription->id)
                ->whereIn('status', ['pending', 'failed'])
                ->where('gateway_reference', 'like', 'cs_%')
                ->get();
            foreach ($openOnline as $txn) {
                PayMongoService::expireCheckoutSession((string) $txn->gateway_reference);
                $txn->update(['status' => 'cancelled']);
            }

            // A fully discounted (₱0) plan has nothing to collect: record it clearly as waived.
            if ($waived) {
                PaymentTransaction::where('subscription_id', $subscription->id)->whereIn('status', ['pending', 'pending_verification'])->delete();
                PaymentTransaction::create([
                    'school_id'       => $school->id,
                    'subscription_id' => $subscription->id,
                    'payment_type'    => 'initial',
                    'new_plan_id'     => $subscription->plan_id,
                    'payment_method'  => 'waived',
                    'amount'          => 0,
                    'status'          => 'paid',
                    'paid_at'         => now(),
                ]);
                $subscription->update(['payment_method' => 'waived']);
            } elseif (!$subscription->payment_method || $openOnline->isNotEmpty()) {
                $subscription->update(['payment_method' => 'manual']);
            }

            $outcome = PaymentActivation::activate($subscription);

            if ($outcome['result'] !== PaymentActivation::ACTIVATED) {
                return response()->json(['success' => false, 'message' => 'This subscription is already active.'], 422);
            }

            $who = $request->user()?->email ?? 'unknown';
            $note = !empty($data['note']) ? " Note: {$data['note']}" : '';
            ActivityLogService::record(
                module: 'Payment',
                action: 'Confirmed payment (manual override)',
                description: "{$school->school_name}: {$who} manually confirmed " . ($waived ? 'a waived (0) plan' : 'a payment of ' . number_format((float) $subscription->amount, 2))
                    . " and activated the school (was {$before}).{$note}",
                schoolId: $school->id,
                request: $request
            );

            NotificationService::toSchoolDean(
                $school->id,
                'payment_verified',
                'Payment confirmed',
                "Your payment was confirmed — {$school->school_name} is now active.",
                '/dean/billing'
            );

            return response()->json(['success' => true, 'message' => "Payment confirmed. {$school->school_name} is now active."]);
        });
    }

    /**
     * Resets an expired (or still-unanswered) subscription offer with a fresh
     * acceptance window, keeping the same plan/amount unless the Super Admin edits them.
     */
    public function resendSchoolOffer(Request $request, int $schoolId): JsonResponse
    {
        $school = School::findOrFail($schoolId);
        $subscription = $school->latestBillableSubscription();

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

        \App\Services\BillingMailer::sendOffer($school, $subscription->fresh(), null, resent: true);

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
            'position' => ['nullable', 'string', Rule::in(\App\Support\HeadTitle::OPTIONS)],
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
                'position'  => \App\Support\HeadTitle::normalize($data['position'] ?? null),
            ]);

            return $user;
        });

        $this->sendDeanInvitation($user, $school);

        ActivityLogService::record(
            module: 'Schools',
            action: 'Invited dean',
            description: "{$user->name} was invited as the " . HT::forDean($user) . " of {$school->school_name}.",
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
            return response()->json(['success' => false, 'message' => 'The ' . HT::forDean($dean) . ' has already activated their account.'], 422);
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
            description: "The " . HT::forDean($dean) . " invitation for {$school->school_name} was resent to {$dean->email}.",
            schoolId: $school->id,
            request: $request
        );

        return response()->json(['success' => true, 'message' => "Invitation resent to {$dean->email}."]);
    }

    private function sendDeanInvitation(User $dean, School $school): void
    {
        // Sent on behalf of the platform, not the Super Admin's personal address.
        AccountInvitationService::send($dean, HT::forDean($dean), "of {$school->school_name}", 'Internova', config('mail.from.address'));
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
                $currentSubscription = $r->school?->subscriptions->where('status', '!=', 'scheduled')->sortByDesc('id')->first();

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
                    'awaiting_payment'          => $r->status === 'approved'
                        && in_array($r->school?->latestBillableSubscription()?->status, ['accepted', 'pending_payment'], true)
                        && $r->school->latestBillableSubscription()->plan?->name === $r->requested_plan
                        && $r->school->latestBillableSubscription()->billing_period === $r->requested_billing_period,
                    'submitted_at'              => $r->created_at?->local()?->format('M d, Y · g:i A'),
                ];
            });

        return response()->json(['requests' => $requests]);
    }

    public function approvePlanChange(Request $request, int $id): JsonResponse
    {
        PlanChangeRequest::findOrFail($id);

        // One transaction with the request and school rows locked: two admins approving the
        // same request, or an approval racing a payment, cannot both write subscription rows.
        return DB::transaction(function () use ($request, $id) {
            $planChangeRequest = PlanChangeRequest::whereKey($id)->lockForUpdate()->firstOrFail();
            School::whereKey($planChangeRequest->school_id)->lockForUpdate()->first();
            $planChangeRequest->load('school');

            return $this->approvePlanChangeLocked($request, $planChangeRequest);
        });
    }

    private function approvePlanChangeLocked(Request $request, PlanChangeRequest $planChangeRequest): JsonResponse
    {
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

        // A change that is not an upgrade must not cut short a term the school already
        // paid for: schedule it for the day after that term ends (billed then).
        $running = $school->currentSubscription();
        if ($running && $running->status === 'active' && !$running->isRenewalExpired() && $amount <= (float) $running->amount && $listPrice <= (float) ($running->list_price ?: $running->amount)) {
            $scheduled = DeanSubscriptionController::scheduleSwitch(
                $school, $running, $plan, $planChangeRequest->requested_billing_period, $listPrice, $discount, $data['agreement_note'] ?? null
            );
            $startsOn = $scheduled->start_date->format('F d, Y');

            $planChangeRequest->update(['status' => 'approved', 'discount_amount' => $discount, 'reviewed_at' => now()]);

            NotificationService::toSchoolDean(
                $school->id,
                'plan_change_approved',
                'Plan change approved',
                "Your switch to {$planChangeRequest->requested_plan} ({$planChangeRequest->requested_billing_period}) starts on {$startsOn}. You keep your current plan until then.",
                '/dean/billing'
            );
            ActivityLogService::record(
                module: 'Subscription',
                action: 'Approved plan change (scheduled)',
                description: "{$school->school_name} will switch to {$planChangeRequest->requested_plan} ({$planChangeRequest->requested_billing_period}) on {$startsOn}.",
                schoolId: $school->id,
                request: $request
            );

            return response()->json(['success' => true, 'scheduled' => true, 'message' => "{$school->school_name} will switch to {$planChangeRequest->requested_plan} on {$startsOn}."]);
        }

        // Upgrade / custom rate: the approval is NOT a payment. It creates the new
        // subscription as an accepted offer awaiting payment (dates are set when it is
        // paid). The current plan keeps governing access until then.
        if ($school->pendingUpgrade()) {
            return response()->json(['success' => false, 'message' => "{$school->school_name} has a payment in progress. Wait for it to finish or have the " . HT::forSchool($school->id) . " cancel it first."], 422);
        }

        $previousPayment = $school->latestBillableSubscription();
        $stillRunning = $running && $running->status === 'active' && !$running->isRenewalExpired();

        // Replace an earlier approved-but-unpaid change and any waiting scheduled switch.
        // Their open PayMongo checkouts are closed too, or the old invoice could still be paid.
        $replaced = $school->subscriptions()->whereIn('status', ['scheduled', 'accepted'])
            ->where('id', '>', $running?->id ?? 0);
        foreach (PaymentTransaction::whereIn('subscription_id', (clone $replaced)->pluck('id'))->whereIn('status', ['pending', 'failed'])->get() as $openTxn) {
            if (str_starts_with((string) $openTxn->gateway_reference, 'cs_')) {
                PayMongoService::expireCheckoutSession((string) $openTxn->gateway_reference);
            }
            $openTxn->update(['status' => 'cancelled']);
        }
        $replaced->update(['status' => 'cancelled']);

        if ($running && $running->status === 'active' && !$stillRunning) {
            $running->update(['status' => 'expired']);
        }

        $newSubscription = $school->subscriptions()->create([
            'plan_id'         => $plan->id,
            'status'          => 'accepted',
            'list_price'      => $listPrice,
            'discount_amount' => $discount,
            'amount'          => $amount,
            'agreement_note'  => $data['agreement_note'] ?? null,
            'billing_period'  => $planChangeRequest->requested_billing_period,
            'payment_method'  => null,
            'payment_status'  => null,
            'offer_sent_at'   => now(),
            'accepted_at'     => now(),
        ]);

        if (!$stillRunning) {
            $school->update(['status' => 'accepted']);
        }

        $planChangeRequest->update([
            'status'          => 'approved',
            'discount_amount' => $discount,
            'reviewed_at'     => now(),
        ]);

        $label = "{$planChangeRequest->requested_plan} ({$planChangeRequest->requested_billing_period})";
        $waived = $amount <= 0;
        NotificationService::toSchoolDean(
            $school->id,
            'plan_change_approved',
            'Plan change approved',
            $waived
                ? "Your change to {$label} is approved at no charge. The Super Admin will activate it for you."
                : "Your change to {$label} is approved. Pay " . \App\Services\SubscriptionBreakdown::money((float) $amount) . ' to start it.',
            '/dean/billing'
        );

        ActivityLogService::record(
            module: 'Subscription',
            action: 'Approved plan change (awaiting payment)',
            description: "{$school->school_name}'s change to {$label} was approved at " . \App\Services\SubscriptionBreakdown::money((float) $amount) . ' and is waiting for payment.',
            schoolId: $school->id,
            request: $request
        );

        return response()->json([
            'success'          => true,
            'awaiting_payment' => true,
            'amount'           => (float) $amount,
            'subscription_id'  => $newSubscription->id,
            'message'          => $waived
                ? "{$school->school_name}'s change to {$planChangeRequest->requested_plan} is approved at no charge. Activate it from the Schools page."
                : "Approved. {$school->school_name} must pay before {$planChangeRequest->requested_plan} starts.",
        ]);
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
            // 'converted' is only ever set by convertInquiryToSchool (it is what creates the school).
            'status' => 'sometimes|string|in:new,contacted,under_discussion,approved,rejected',
            'notes'  => 'sometimes|nullable|string|max:2000',
        ]);

        if (isset($data['status']) && $inquiry->school_id) {
            return response()->json(['success' => false, 'message' => 'This registration was already approved and has a school; its status can no longer be changed.'], 422);
        }

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

    /** Schools currently on a plan: same rule as the revenue report (active and not past its end date), so an expired school is not counted as active. */
    private function activeSchoolsOn(int $planId): int
    {
        return SchoolSubscription::where('plan_id', $planId)->where('status', 'active')
            ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', \App\Support\LocalTime::today()))
            ->count();
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
                    'active_schools' => $this->activeSchoolsOn($plan->id),
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
            'monthly_price' => 'required|numeric|min:0|max:9999999.99',
            'yearly_price'  => 'required|numeric|min:0|max:9999999.99',
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
                'active_schools' => $this->activeSchoolsOn($plan->id),
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
            'last_message_at' => $last?->created_at?->local()?->format('M d, Y g:i A'),
            'created_at' => $t->created_at->local()->format('M d, Y'),
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
            'created_at' => $m->created_at->local()->format('M d, Y g:i A'),
        ];
    }

    public function supportMessages(Request $request): JsonResponse
    {
        $query = SupportTicket::with(['school', 'coordinator', 'messages'])->orderByDesc('updated_at')->orderByDesc('id');

        // Opt-in paging: the status filter (Open / Resolved) narrows the whole set before it is cut into pages.
        if (Paging::requested($request)) {
            if (in_array($status = $request->query('status'), ['Open', 'Resolved'], true)) {
                $query->where('status', $status);
            }
            $page = $query->paginate(Paging::perPage($request, 15, 50));

            return response()->json([
                'messages' => collect($page->items())->map(fn (SupportTicket $t) => $this->mapSupportTicket($t))->values(),
                ...Paging::meta($page),
                'channel_live' => true,
            ]);
        }

        return response()->json([
            'messages' => $query->get()->map(fn (SupportTicket $t) => $this->mapSupportTicket($t)),
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
                'attachment_type' => $file->getMimeType(),
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
                'timestamp'   => $log->created_at->local()->format('M d, Y \a\t g:i A'),
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
            'value' => $setting->type === 'toggle'
                ? 'required|boolean'
                : ($key === 'support_email' ? 'required|email|max:255' : 'required|string|max:255'),
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
