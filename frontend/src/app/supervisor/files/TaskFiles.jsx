import ComingSoon from "@/components/ComingSoon";
import { Page, PageHeader } from "@/components/dash/page";

export default function TaskFiles() {
  return (
    <Page>
      <PageHeader title="Task Files" sentence="Upload and review task-related documents." />
      <ComingSoon
        icon="file"
        title="Task files aren't built yet"
        description="Coordinators can already upload and review compliance documents from their own Documents screen. A task-attachment view for supervisors hasn't been built yet."
      />
    </Page>
  );
}
