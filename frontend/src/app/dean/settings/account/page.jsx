import AccountSettings from "@/components/AccountSettings";
import SettingsScreen from "@/components/settings/SettingsScreen";

export default function Page() {
  return (
    <SettingsScreen role="dean">
      <AccountSettings />
    </SettingsScreen>
  );
}
