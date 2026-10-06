# Evaluations (formal OJT evaluation, criteria, manual evaluation)
last_commit: 5a24cfb + uncommitted
updated: 2026-10-06

## Map (where the code lives)
- backend/routes/api.php — coordinator L174-176 (evaluation-criteria GET/POST, evaluations GET), supervisor L217-220 (criteria GET, evaluations GET/POST, evaluations/manual POST), intern L241 (evaluations GET).
- SupervisorMonitoringController.php — AUTO_GRADED_CATEGORY const ~L596 ('A. Technical Ability'); evaluationCriteria L597 (adds task_rating_average + suggested_score per criterion when ?deployment_id=); evaluations L621; storeEvaluation L663 (plan gate FORMAL_EVALUATIONS; validates scores[], category_comments; weighted overall_score); storeManualEvaluation L756 (overall_score 0-100, no criteria, always allowed).
- CoordinatorMonitoringController.php — evaluationCriteria L698, storeEvaluationCriterion L706 (category,name,max_score,weight), evaluations L722 (school-wide, with scores.criterion).
- InternMonitoringController.php — evaluations L972 (own evaluations).
- backend/app/Services/DefaultEvaluationCriteria.php — rows() the school's printed rubric (sections A Technical, B Interpersonal, ...; max_score == weight, totals 100); seedFor($schoolId) called from SuperadminFullController L281 when a school is created.
- backend/app/Services/TaskRatingAverage.php — see tasks.md.
- Models: Evaluation, EvaluationCriterion (fillable incl. category), EvaluationScore.
- Frontend: supervisor/evaluations/DailyPerformanceEvaluation.jsx = LIST only (filters, cards, breakdown, ?saved=<id> highlight+Banner); supervisor/evaluations/new/NewEvaluation.jsx = full-page form (formal + manual modes, ?intern=<deploymentId>, live summary aside/mobile bar, ConfirmDialog submit + leave guard); evalHelpers.js (scoreTone, gradeBand). Old components EvaluationForm/ManualEvaluationForm deleted. Still: intern/evaluations/MyEvaluations.jsx, coordinator/evaluations/EvaluationMonitoring.jsx (amber note when criteria max_score sum != 100), components/EvaluationView (coordinator+intern). Proxies via the role catch-all api/[...path]/route.js.
- DB: evaluation_criteria (school_id, category, name, max_score, weight, status), evaluations (deployment_id, evaluator_id, evaluation_type, evaluation_date, overall_score, remarks, category_comments, status), evaluation_scores (evaluation_id, criteria_id, score, remarks). Schema sql lacks category/category_comments; see migrations 2026_08_14_1207*. Column derived_from_task_ratings was added then dropped.

- Supervisor evaluations (formal/manual/list) use visibleToSupervisor; evaluator_id still records who evaluated. (see coordinator-monitoring log for the shared rule)

## How it works
Each school is seeded with the default rubric; coordinator can add criteria. Supervisor picks an assigned intern (deployment), form loads criteria; Technical Ability items get suggested scores = task-rating average scaled to max_score. Submit -> Evaluation + EvaluationScores, overall score weighted by criterion weight. Schools without Formal Evaluations plan use the manual evaluation (single overall score + remarks). No edit endpoint exists: submitted evaluations are final. Types offered now Midterm/Final (backend accepts any string). Intern and coordinator view results read-only via EvaluationView.

## How to test
- Existing tests: backend/tests/Feature (InternovaApiTest etc.); no evaluation-specific test found by name (not verified deeply). InternovaSeederTest may touch seeded criteria.
- Manual: as supervisor with an intern who has rated tasks, open Evaluations, confirm Technical Ability suggested scores, submit; check intern and coordinator pages show it; as coordinator add a criterion.
- `cd backend && php artisan test`.

## History (newest first)
- 2026-10-06 5a24cfb + uncommitted — evaluations split into list + /new page, friendlier sizing, criteria-total note; no backend change — result: pass (backend 80/80, webpack build ok, lint clean in supervisor/evaluations)
- 2026-10-06 5a24cfb + uncommitted — supervisor scoping moved from deployments.supervisor_id to company (both supervisors identical powers) — result: pass (backend 80/80, build ok)
- 2026-10-05 cef02dc — initial log created (documentation only, no code changes) — result: n/a
