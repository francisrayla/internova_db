import SettingsScreen from "@/components/settings/SettingsScreen";
import SystemSettings from "../../system-settings/SystemSettings";

export default function Page() {
  return (
    <SettingsScreen role="superadmin">
      <SystemSettings />
    </SettingsScreen>
  );
}
