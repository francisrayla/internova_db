import SchoolDetailsCard from "@/components/SchoolDetailsCard";
import SettingsScreen from "@/components/settings/SettingsScreen";
import { Page as PageFrame, PageHeader } from "@/components/dash/page";

export default function Page() {
  return (
    <SettingsScreen role="coordinator">
      <PageFrame>
        <PageHeader title="School information" sentence="Basic information for your school account. Only your Dean can change it." />
        <SchoolDetailsCard role="coordinator" readOnly />
      </PageFrame>
    </SettingsScreen>
  );
}
