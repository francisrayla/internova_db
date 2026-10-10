import WeeklyEmailPreference from "@/components/dean/WeeklyEmailPreference";
import { Page, PageHeader } from "@/components/dash/page";

export default function NotificationSettingsPage() {
  return (
    <Page className="max-w-4xl">
      <PageHeader back={{ href: "/dean/settings", label: "Settings" }} title="Email notifications" sentence="Choose which emails Internova sends you." />
      <WeeklyEmailPreference />
    </Page>
  );
}
