# Subscription & billing
last_commit: 1b9390d + uncommitted
updated: 2026-10-05

## Map (where the code lives)
- backend/app/Http/Controllers/Api/DeanSubscriptionController.php (renamed from CoordinatorSubscriptionController, same logic, line numbers unchanged): Dean self-service. paymongo() L34, createCheckoutSession L50, calculateProration L87, supersedeOtherActive L114, upgradeQuote L126, rejectIfExpired L157, acceptOffer L172, checkout L191, verifyCheckout L290, switchPlan L359, requestUpgrade L425, cancelPendingUpgrade L555, requestPlanChange L584, uploadProof L623.
- backend/app/Services/PlanFeatures.php (28 L): consts SUBTASKS/ATTACHMENTS/TASK_RATINGS/FORMAL_EVALUATIONS/AI_FEATURES; has($school,$feature) = label is in current plan's `features` array.
- Gate call sites (inline checks, no middleware): InternMonitoringController L315/344/427/857, SupervisorMonitoringController L226/323/665, SuperadminFullController aiUsage L775, Jobs/GenerateNarrativeForAttendance L67.
- backend/app/Http/Controllers/Api/SuperadminFullController.php (admin side): convertInquiryToSchool L201 (creates school + offer), verifySchoolPayment L314, confirmSchoolPayment L353, resendSchoolOffer L388, toggleSchoolSuspension L437, planChangeRequests L499, approvePlanChange L526, rejectPlanChange L596, plansFeatures L673, updatePlan L699.
- backend/routes/api.php: `dean` group `/api/dean/schools/{id}/...` behind role:dean + dean.school (accept-offer, checkout, verify-checkout, upload-proof, switch-plan, upgrade-plan, cancel-pending-upgrade, upgrade-quote, request-plan-change); superadmin L34-39, L49-51. Config: config/services.php 'paymongo' (PAYMONGO_SECRET_KEY / PUBLIC_KEY).
- Models: School::currentSubscription() (L52: latest active else latest), SchoolSubscription (OFFER_PENDING_STATUSES, expiry helpers), SubscriptionPlan, PaymentTransaction, PlanChangeRequest.
- frontend/src/app/dean/billing/SubscriptionBilling.jsx (moved from coordinator/subscription): offer/checkout/upgrade UI; dean/preview/PreviewMode.jsx. coordinator/subscription-status/SubscriptionStatus.jsx: coordinator's read-only screen (waiting for Dean / suspended / expired).
- frontend/src/app/api/dean/schools/[id]/{accept-offer,checkout,verify-checkout,upload-proof,switch-plan,upgrade-plan,upgrade-quote,cancel-pending-upgrade,request-plan-change}/route.js: Next proxies to Laravel.
- frontend/src/app/superadmin/plans/PlansFeatures.jsx (309 L): edit plan prices/features. superadmin/billing/BillingOverview.jsx (394 L): plan-change request approve/reject (L57, L81). superadmin/schools/SchoolsManagement.jsx (509 L): confirm/verify payment, resend offer, suspend.
- DB: school_subscriptions (plan_id, status, list_price, amount, discount_amount, billing_period, start/end_date, offer_sent_at/offer_expires_at, accepted_at, payment_method/status/reference, proof_of_payment_path, paid_at), subscription_plans (monthly/yearly_price, features JSON, is_active), payment_transactions (payment_type, previous/new_plan_id, gateway_reference, proof_path), plan_change_requests (requested_plan, requested_billing_period, status, discount_amount).

## How it works (max ~10 lines)
Inquiry -> superadmin convertInquiryToSchool creates school + subscription offer (offer_expires_at). The school's Dean (not the coordinator any more) acceptOffer, then pays via PayMongo checkout (checkout creates session, verifyCheckout confirms) or uploads manual proof (uploadProof) which superadmin verifies/confirms. Expired active subs are detected lazily (rejectIfExpired). Upgrades: upgradeQuote prorates, requestUpgrade starts a pending payment while the current plan stays active, cancelPendingUpgrade aborts; a confirmed one supersedes others (supersedeOtherActive). Other changes go through requestPlanChange -> superadmin approve/reject. Feature gating is label membership in plan.features via PlanFeatures::has (only Premium-exclusive labels gated; Basic and Premium share the rest). Suspension via toggleSchoolSuspension.

## How to test
DeanTest.php covers dean accept-offer + coordinator 403/404 + cross-school dean 403. Manual: submit /inquiry, convert in superadmin Inquiries, log in as the Dean -> /dean/billing, accept offer, pay with PayMongo test keys or upload proof, confirm in superadmin Schools; check a Basic school is blocked on subtasks/AI and a Premium one is not.

## History (newest first, keep only the last 5)
- 2026-10-05 1b9390d + uncommitted — billing moved from coordinator to Dean (routes /api/dean, frontend /dean/billing), billing notifications via NotificationService::toSchoolDean; see dean.md — result: tests 23/23 pass (see dean.md)
- 2026-10-05 cef02dc — first log created (read-only mapping, no code changes) — result: n/a
