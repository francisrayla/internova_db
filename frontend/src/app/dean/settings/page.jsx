import SchoolDetailsCard from "@/components/SchoolDetailsCard";

export default function Page() {
  return (
    <div className="sm:p-2 lg:p-6">
      <h1 className="text-2xl font-semibold">School Settings</h1>
      <p className="mt-2 text-slate-600">Basic information for your school account. Your coordinator can see these details but not edit them.</p>

      <SchoolDetailsCard role="dean" />
    </div>
  );
}
