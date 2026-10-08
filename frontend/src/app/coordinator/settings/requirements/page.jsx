import SettingsScreen from "@/components/settings/SettingsScreen";
import CourseRequirementsCard from "../CourseRequirementsCard";

export default function Page() {
  return (
    <SettingsScreen role="coordinator">
      <CourseRequirementsCard />
    </SettingsScreen>
  );
}
