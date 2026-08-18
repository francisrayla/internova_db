"use client";

import TaskDetailView from "@/components/TaskDetailView";
import { fetchInternData } from "@/lib/internApi";

export default function TaskDetails() {
  return (
    <TaskDetailView
      fetchTask={(id) => fetchInternData(`tasks/${id}`)}
      apiBase="/api/intern"
      backHref="/intern/tasks"
      backLabel="Back to Tasks"
      canAddSubtask={(task) => !task.is_group || task.is_leader}
      canChangeStatus
    />
  );
}
