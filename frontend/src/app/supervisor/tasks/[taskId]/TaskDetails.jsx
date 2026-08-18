"use client";

import TaskDetailView from "@/components/TaskDetailView";
import { fetchSupervisorData } from "@/lib/supervisorApi";

export default function TaskDetails() {
  return (
    <TaskDetailView
      fetchTask={(id) => fetchSupervisorData(`tasks/${id}`)}
      apiBase="/api/supervisor"
      backHref="/supervisor/tasks"
      backLabel="Back to Tasks"
      canAddSubtask
      canRate
    />
  );
}
