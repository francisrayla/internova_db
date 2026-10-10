// What each plan feature means, in plain words. Labels are the exact strings
// stored in SubscriptionPlan.features (and checked by App\Services\PlanFeatures
// on the backend), so don't reword the optional ones without a migration.

// Part of every plan; nothing to switch on or off.
export const CORE_FEATURES = [
  { label: "GPS + Selfie Attendance", hint: "Interns clock in and out with a selfie, GPS location and time." },
  { label: "Task Management (Pending / Ongoing / Done)", hint: "Supervisors assign tasks and track their progress." },
  { label: "Messaging & Group Chat", hint: "Coordinators, supervisors and interns can message each other." },
  { label: "Portfolio & Narrative Report", hint: "Auto-generated from attendance and tasks, with a Word download. Written from a template, no AI." },
  { label: "Basic Monitoring & Reports", hint: "Hours, attendance and task progress for every intern." },
];

// Can be turned on or off per plan.
export const OPTIONAL_FEATURES = [
  { label: "Formal Evaluations", hint: "Grade interns against the school's own criteria (one evaluation per intern)." },
  { label: "Subtasks", hint: "Break a task into smaller steps." },
  { label: "Attachments", hint: "Interns attach proof of work (photos, files) when finishing a task." },
  { label: "Task Comments", hint: "Comments on each task." },
  { label: "Per-task Rating + Comments", hint: "Supervisors rate every finished task." },
  { label: "AI Narrative Writing", hint: "AI writes the daily narrative automatically and polishes what interns type." },
];

export const CORE_LABELS = CORE_FEATURES.map((f) => f.label);
