import WeeklyEmailPreference from "@/components/dean/WeeklyEmailPreference";
import SettingsScreen from "@/components/settings/SettingsScreen";

export default function Page() {
  return (
    <SettingsScreen role="dean">
      <h2 className="text-xl font-semibold text-slate-900">Email notifications</h2>
      <p className="mt-1 text-sm text-slate-600">Choose which emails Internova sends you.</p>
      <WeeklyEmailPreference />
    </SettingsScreen>
  );
}
