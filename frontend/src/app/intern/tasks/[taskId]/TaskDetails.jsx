"use client";

import TaskDetailView from "@/components/TaskDetailView";
import { fetchInternData } from "@/lib/internApi";
import { useCurrentUser } from "@/lib/UserContext";
import { PLAN_FEATURES, hasPlanFeature } from "@/lib/planFeatures";

export default function TaskDetails() {
  const { user } = useCurrentUser();
  const subtasksEnabled = hasPlanFeature(user, PLAN_FEATURES.SUBTASKS);

  return (
    <TaskDetailView
      fetchTask={(id) => fetchInternData(`tasks/${id}`)}
      apiBase="/api/intern"
      backHref="/intern/tasks"
      backLabel="Back to Tasks"
      canAddSubtask={(task) => subtasksEnabled && (!task.is_group || task.is_leader)}
      canChangeStatus
      requireProof={hasPlanFeature(user, PLAN_FEATURES.ATTACHMENTS)}
    />
  );
}
