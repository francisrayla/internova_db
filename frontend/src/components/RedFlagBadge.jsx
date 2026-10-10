import { Flag } from "lucide-react";

/** The red flag on an attendance record: an odd-hours clock-in (for example 6:12 PM) or a suspicious location.
 * The same badge on every screen that lists attendance; once a supervisor has checked it, it stays red but says
 * who checked it and when. Pairs with a red left border on the row. */
export default function RedFlagBadge({ record, className = "" }) {
  if (!record?.red_flag) return null;

  return (
    <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700"
        title="This record needs the supervisor's attention: an unusual clock-in hour or a suspicious location."
      >
        <Flag size={12} aria-hidden="true" />
        {record.red_flag_text ?? "Red flag"}
      </span>
      {record.red_flag_checked && (
        <span className="text-xs text-slate-500">
          Checked{record.red_flag_checked_by ? ` by ${record.red_flag_checked_by}` : ""}
          {record.red_flag_checked_at ? ` · ${record.red_flag_checked_at}` : ""}
        </span>
      )}
    </span>
  );
}
