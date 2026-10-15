import SchoolDetailsCard from "@/components/SchoolDetailsCard";
import HeadTitleCard from "@/components/dean/HeadTitleCard";
import { Page, PageHeader } from "@/components/dash/page";

export default function SchoolSettingsPage() {
  return (
    <Page className="max-w-4xl">
      <PageHeader
        back={{ href: "/dean/settings", label: "Settings" }}
        title="School information"
        sentence="Basic information for your school account. Your coordinator can see these details but not edit them."
      />
      <SchoolDetailsCard role="dean" />
      <HeadTitleCard />
    </Page>
  );
}
