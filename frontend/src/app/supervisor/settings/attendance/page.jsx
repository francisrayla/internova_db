import SettingsScreen from "@/components/settings/SettingsScreen";
import AttendanceSettings from "../AttendanceSettings";

export default function Page() {
  return (
    <SettingsScreen role="supervisor">
      <AttendanceSettings />
    </SettingsScreen>
  );
}
