import ComingSoon from "@/components/ComingSoon";

export default function TaskFiles() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Task Files</h2>
        <p className="mt-1 text-sm text-slate-600">Upload and review task-related documents.</p>
      </div>
      <ComingSoon
        icon="file"
        title="Task files aren't built yet"
        description="Coordinators can already upload and review compliance documents from their own Documents screen. A task-attachment view for supervisors hasn't been built yet."
      />
    </div>
  );
}
