"use client";

import SchoolDetailsCard from "@/components/SchoolDetailsCard";
import NarrativeReportCard from "./NarrativeReportCard";

export default function SchoolSettingsPage() {
  return (
    <div className="sm:p-2 lg:p-6">
      <h1 className="text-2xl font-semibold">School Settings</h1>
      <p className="mt-2 text-slate-600">Basic information for your school account.</p>

      <SchoolDetailsCard role="coordinator" readOnly />

      <NarrativeReportCard />
    </div>
  );
}
