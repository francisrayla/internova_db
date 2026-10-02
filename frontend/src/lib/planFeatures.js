// Mirrors backend App\Services\PlanFeatures — same exact label strings
// SubscriptionPlan.features stores, so a check here and a check there never
// drift apart. Every gated backend endpoint re-checks independently; this
// is only for hiding controls the user can't use anyway.
export const PLAN_FEATURES = {
  SUBTASKS: "Subtasks",
  ATTACHMENTS: "Attachments",
  TASK_RATINGS: "Per-task Rating + Comments",
  FORMAL_EVALUATIONS: "Formal Evaluations",
  AI_FEATURES: "AI Portfolio / Reports",
};

export function hasPlanFeature(user, feature) {
  return Array.isArray(user?.plan_features) && user.plan_features.includes(feature);
}
