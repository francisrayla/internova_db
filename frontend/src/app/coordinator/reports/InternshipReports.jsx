import ComingSoon from "@/components/ComingSoon";

export default function InternshipReports() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Internship Reports</h2>
        <p className="mt-1 text-sm text-slate-600">Generate formal internship progress reports.</p>
      </div>
      <ComingSoon
        icon="list"
        title="Report generation isn't built yet"
        description="Interns, Attendance, Tasks, and Evaluations already have real data behind them — a screen to compile that into a formal exportable report hasn't been built yet."
      />
    </div>
  );
}
