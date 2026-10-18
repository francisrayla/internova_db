import SettingsScreen from "@/components/settings/SettingsScreen";
import CompanyLocation from "../CompanyLocation";

export default function Page() {
  return (
    <SettingsScreen role="supervisor">
      <CompanyLocation />
    </SettingsScreen>
  );
}
