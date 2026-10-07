"use client";

import { useState } from "react";
import PhotoViewer from "@/components/PhotoViewer";
import OfflineEntryBadge from "@/components/OfflineEntryBadge";
import OfflineImage from "@/components/OfflineImage";

export const STATUS_STYLES = {
  approved: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
};

/** The date, time, and GPS coordinates are already baked into each selfie's
 * pixels (see CameraCapture in Attendance.jsx) — the card shows the two
 * photos as equal-size slots (so every card is the same shape whether or not
 * the intern has timed out yet), each opening full-size on click. */
function PhotoSlot({ label, time, url, emptyText, onOpen }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 flex items-baseline justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        <span className="font-medium normal-case tracking-normal text-slate-700">{time ?? "—"}</span>
      </p>
      {url ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`View ${label.toLowerCase()} photo`}
          className="block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-slate-100 hover:border-blue-400"
        >
          <OfflineImage src={url} alt={`${label} selfie`} className="h-full w-full object-cover" />
        </button>
      ) : (
        <div className="grid aspect-[4/3] w-full place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-2 text-center text-xs text-slate-400">
          {emptyText}
        </div>
      )}
    </div>
  );
}

export default function AttendanceCard({ record }) {
  const [viewing, setViewing] = useState(null);
  const hasIn = !!record.clock_in_selfie_url;
  const hasOut = !!record.clock_out_selfie_url;
  const photos = [
    hasIn && { url: record.clock_in_selfie_url, label: `Time In · ${record.attendance_date}` },
    hasOut && { url: record.clock_out_selfie_url, label: `Time Out · ${record.attendance_date}` },
  ].filter(Boolean);
  const outIndex = hasIn ? 1 : 0;

  const outEmpty = record.auto_clocked_out ? "Auto time-out — no photo" : record.clock_in ? "Not timed out yet" : "No photo";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">
          {record.attendance_date}
          {record.session_label && <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{record.session_label}</span>}
        </p>
        <div className="flex items-center gap-1.5">
          <OfflineEntryBadge record={record} />
          {record.edited && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700" title="Your supervisor corrected the time because you did not time out">
              Time corrected
            </span>
          )}
          {record.auto_clocked_out && (
            <span
              className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700"
              title="Forgot to time out — closed automatically after 8 hours, no photo or location"
            >
              Auto time-out
            </span>
          )}
          {record.status !== "approved" && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[record.status] ?? "bg-slate-100 text-slate-700"}`}>
              {record.status}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <PhotoSlot
          label="Time In"
          time={record.clock_in}
          url={record.clock_in_selfie_url}
          emptyText="No photo"
          onOpen={() => setViewing(0)}
        />
        <PhotoSlot
          label="Time Out"
          time={record.clock_out}
          url={record.clock_out_selfie_url}
          emptyText={outEmpty}
          onOpen={() => setViewing(outIndex)}
        />
      </div>

      <p className="mt-3 text-xs font-medium text-slate-500">
        {record.hours != null ? (
          <>
            <span className="text-sm font-semibold text-slate-800">{record.hours}h</span> rendered
          </>
        ) : (
          "In progress"
        )}
      </p>

      {viewing !== null && <PhotoViewer photos={photos} index={viewing} onIndexChange={setViewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
