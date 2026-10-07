import SchoolDetailsCard from "@/components/SchoolDetailsCard";
import SettingsScreen from "@/components/settings/SettingsScreen";

export default function Page() {
  return (
    <SettingsScreen role="coordinator">
      <h2 className="text-xl font-semibold text-slate-900">School information</h2>
      <p className="mt-1 text-sm text-slate-600">Basic information for your school account. Only your Dean can change it.</p>
      <SchoolDetailsCard role="coordinator" readOnly />
    </SettingsScreen>
  );
}
