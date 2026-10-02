"use client";

import TaskDetailView from "@/components/TaskDetailView";
import { fetchSupervisorData } from "@/lib/supervisorApi";
import { useCurrentUser } from "@/lib/UserContext";
import { PLAN_FEATURES, hasPlanFeature } from "@/lib/planFeatures";

export default function TaskDetails() {
  const { user } = useCurrentUser();

  return (
    <TaskDetailView
      fetchTask={(id) => fetchSupervisorData(`tasks/${id}`)}
      apiBase="/api/supervisor"
      backHref="/supervisor/tasks"
      backLabel="Back to Tasks"
      canAddSubtask={hasPlanFeature(user, PLAN_FEATURES.SUBTASKS)}
      canRate={hasPlanFeature(user, PLAN_FEATURES.TASK_RATINGS)}
    />
  );
}
