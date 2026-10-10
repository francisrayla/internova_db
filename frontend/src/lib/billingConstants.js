// Billing facts the frontend needs and no API returns yet. Keep them in this one file.
//
// BANK_DETAILS mirrors DeanSubscriptionController::BANK_DETAILS (the same placeholder the
// bank-transfer checkout answer carries). When the backend serves them to the Dean page,
// delete this constant and read them from that answer.
export const BANK_DETAILS = {
  bankName: "BDO Unibank",
  accountName: "Internova Technologies Inc.",
  accountNumber: "0012-3456-7890",
};

// Published list prices, matching the seeded SubscriptionPlan rows. Used by the Dean plan cards
// (no Dean endpoint serves plan prices) and as a fallback for the Super Admin approve form, which
// reads the live prices from GET /api/superadmin/plans-features first.
export const PLAN_PRICES = {
  Basic: { monthly: 1500, yearly: 15000 },
  Premium: { monthly: 3500, yearly: 35000 },
};

// GCash, Maya and Card still go through PayMongo's sandbox until live keys are set. Set
// NEXT_PUBLIC_PAYMONGO_LIVE=true on the frontend service (and rebuild) to hide the "Test mode" wording.
export const PAYMENT_TEST_MODE = process.env.NEXT_PUBLIC_PAYMONGO_LIVE !== "true";
