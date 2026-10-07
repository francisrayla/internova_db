# Tasks (intern / supervisor / coordinator, subtasks, comments, ratings)
last_commit: 5a24cfb + uncommitted
updated: 2026-10-06

## Map (where the code lives)
- backend/routes/api.php — coordinator (L158-164, view-only + comments), supervisor (L202-212), intern (L228-236) task routes.
- backend/app/Http/Controllers/Api/SupervisorMonitoringController.php — tasks L88, storeTask L140 (deployment_ids[] => group task), taskShow L206, evaluateTask L224 (1-10 rating, only when status=completed, plan feature TASK_RATINGS), storeSubtask L321, destroySubtask L365, storeTaskComment L385, storeSubtaskComment L417.
- backend/app/Http/Controllers/Api/InternMonitoringController.php — tasks L101, taskShow L158, updateTask L260, completeTask L293 (needs all subtasks done, leader-only for group tasks, proof required if Attachments plan), storeSubtask L342, updateSubtask L390, completeSubtask L416, comments L441/L460.
- backend/app/Http/Controllers/Api/CoordinatorMonitoringController.php — tasks L406, taskShow L470, storeTaskComment L539, storeSubtaskComment L558 (no create/edit).
- backend/app/Services/TaskRatingAverage.php — forDeployment() avg of task_evaluations.rating via task.assignees; scaledTo(avg,max) = avg/10*max. Used by evaluations (see evaluations.md).
- backend/app/Services/PlanFeatures.php — SUBTASKS, ATTACHMENTS, TASK_RATINGS gates (L17-19).
- Models (backend/app/Models): Task (fillable company_id, assigned_by, leader_id...; recalculateStatusFromSubtasks L68, setStatus L93), TaskAssignee, Subtask, TaskComment, TaskEvaluation, TaskProof.
- Frontend pages (thin page.jsx -> component): intern/tasks/MyTasks.jsx, intern/tasks/[taskId]/TaskDetails.jsx; supervisor/tasks/TaskManagement.jsx, supervisor/tasks/[taskId]/TaskDetails.jsx; coordinator/tasks/TaskMonitoring.jsx, coordinator/tasks/company/[companyId]/CompanyTasks.jsx, coordinator/tasks/[taskId]/TaskDetails.jsx.
- Shared UI (frontend/src/components): TaskDetailView.jsx (all 3 roles' detail pages, props fetchTask/apiBase/canAddSubtask/canChangeStatus/requireProof), TaskListBoard, SubtaskBoard, TaskHistoryRow, DueDateBadge.
- Proxies: frontend/src/app/api/{intern,supervisor,coordinator}/[...path]/route.js (catch-all, no task-specific routes). Data helper: frontend/src/lib/internApi.js (fetchInternData).
- DB: tasks, task_assignees, subtasks, task_comments, task_proofs, task_evaluations (unique task_id; rating widened). NOTE internova_database_schema.sql is stale (still has deployment_id/assigned_to); real shape comes from migrations 2026_08_14_*(restructure_tasks_for_group_assignment, task_assignees, task_proofs, leader_id, multi_assignee subtasks) and 2026_08_15 widen rating.

- Supervisor tasks: Task::scopeVisibleToSupervisor (tasks whose assignee deployments are at the supervisor's company), so both supervisors see/create/rate each other's tasks; Task::setStatus completed notifies all active supervisors of the assignees' companies (fallback assigned_by). (see coordinator-monitoring log for the shared rule)

- DRAG (2026-10-07): frontend/src/lib/useDragSensors.js — MouseSensor (drag 6px, instant) + TouchSensor (hold 250ms, tolerance 8, quick swipe still scrolls); rows get DRAG_ROW_CLASS + blockTouchContextMenu, links/buttons `draggable={false}`. Used by components/SubtaskBoard.jsx and TaskListBoard.jsx (the old single PointerSensor with a 350ms hold cancelled a normal mouse drag, a link was natively draggable, and phones took the touch as a scroll/selection).

- GROUP LEADER (2026-10-07): SupervisorMonitoringController::storeTask now REQUIRES leader_id when more than one intern is assigned (422 with errors.leader_id; the leader must be one of the assignees); one intern = no leader. Form: supervisor/tasks/TaskManagement.jsx AssignTaskModal (required select "Task leader *"). Group tasks created before this may still have leader_id NULL (nobody can submit them). Tests: GroupTaskLeaderTest.

- NO-MEMBER / PENDING (2026-10-07): storeSubtask (supervisor + intern controllers) rejects an empty assignee list (a solo task still defaults to its one intern) and members with status pending_activation. Pending interns are excluded from internOptions and refused by storeTask. Frontend: components/TaskDetailView.jsx AddSubtaskForm; supervisor/tasks/TaskManagement.jsx shows a 'not set up an account yet' note. Test: tests/Feature/PendingAccountTaskTest.php.

## How it works
Supervisor creates a task for one or many interns (deployment_ids) -> task_assignees rows; group tasks have a leader. Intern moves status (updateTask), adds/completes subtasks (plan-gated), uploads proof, completes task (leader only for groups). Task status can be derived from subtasks (Task::recalculateStatusFromSubtasks). Supervisor rates completed tasks 1-10 (+comments), notifies assignees ("task_evaluated"). Coordinator only views + comments across school/companies. Comments exist on tasks and subtasks for all three roles. Ratings feed the Technical Ability section of the formal evaluation.

## How to test
- Existing tests: backend/tests/Feature has ExampleTest, InternovaApiTest, InternovaSeederTest, SuperadminApiTest; grep found NO task-specific test functions (not verified deeply).
- Manual: login as supervisor -> Tasks -> create task for an intern; login as intern -> open task, add subtask, complete, complete task; as supervisor rate it (needs Per-task Rating plan feature); as coordinator confirm read-only view and comment.
- Backend: `cd backend && php artisan test`; frontend `cd frontend && npm run build`.

## History (newest first)
- 2026-10-07 uncommitted — a subtask must have a member (422 errors.assignee_ids; form: required 'Assign to *' + Select everyone); interns still pending_activation are left out of task assignment (InternshipDeployment::scopeAccountSetUp, internOptions, storeTask 422, tasks response not_set_up[]) — result: PendingAccountTaskTest 5/5, full suite 151/151, headless subtask form ok
- 2026-10-07 uncommitted — leader required for group tasks (backend 422 + required select) — result: GroupTaskLeaderTest 4/4, full suite 139/139, headless assign flow ok
- 2026-10-07 uncommitted — intern subtask/task drag fixed on desktop and phone (see DRAG) — result: lint ok; synthetic mouse/touch/swipe/click checks in headless Chrome (CDP native input does not reach this headless build, so events were dispatched in-page)
- 2026-10-06 5a24cfb + uncommitted — supervisor scoping moved from deployments.supervisor_id to company (both supervisors identical powers) — result: pass (backend 80/80, build ok)
- 2026-10-05 cef02dc — initial log created (documentation only, no code changes) — result: n/a
