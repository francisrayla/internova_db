import SchoolDetailsCard from "@/components/SchoolDetailsCard";
import SettingsScreen from "@/components/settings/SettingsScreen";

export default function Page() {
  return (
    <SettingsScreen role="dean">
      <h2 className="text-xl font-semibold text-slate-900">School information</h2>
      <p className="mt-1 text-sm text-slate-600">Basic information for your school account. Your coordinator can see these details but not edit them.</p>
      <SchoolDetailsCard role="dean" />
    </SettingsScreen>
  );
}
