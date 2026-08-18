"use client";

import TaskDetailView from "@/components/TaskDetailView";
import { fetchCoordinatorData } from "@/lib/coordinatorApi";

export default function TaskDetails() {
  return (
    <TaskDetailView
      fetchTask={(id) => fetchCoordinatorData(`tasks/${id}`)}
      apiBase="/api/coordinator"
      backHref="/coordinator/tasks"
      backLabel="Back to Tasks"
      resolveBackHref={(task) => `/coordinator/tasks/company/${task.company_id}`}
      canAddSubtask={false}
    />
  );
}
