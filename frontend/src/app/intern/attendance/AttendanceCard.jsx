"use client";

import { useState } from "react";
import NavIcon from "@/components/NavIcon";
import PhotoViewer from "@/components/PhotoViewer";
import OfflineEntryBadge from "@/components/OfflineEntryBadge";
import OfflineImage from "@/components/OfflineImage";
import { Pill } from "@/components/ui";

// Status word to the calm chip tone used everywhere else.
export const STATUS_TONES = { approved: "green", pending: "amber", rejected: "red" };

/** The date, time, and GPS coordinates are already baked into each selfie's
 * pixels (see CameraCapture in Attendance.jsx) — the card shows the two
 * photos as equal-size slots (so every card is the same shape whether or not
 * the intern has timed out yet), each opening full-size on click. */
function PhotoSlot({ label, time, url, emptyText, onOpen }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium text-slate-500">
        <span>{label}</span>
        <span className="font-semibold text-slate-900">{time ?? "—"}</span>
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
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-2 text-center text-xs text-slate-500">
          <NavIcon name="user" size={16} />
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

  const outEmpty = record.auto_clocked_out ? "Auto time-out, no photo" : record.clock_in ? "Not timed out yet" : "No photo";

  return (
    <div className="dash-card h-full p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <p className="min-w-0 text-sm font-semibold text-slate-900">
          {record.attendance_date}
          {record.session_label && <span className="ml-2 align-middle"><Pill tone="blue" size="sm">{record.session_label}</Pill></span>}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <OfflineEntryBadge record={record} />
          {record.edited && (
            <span title="Your supervisor corrected the time because you did not time out">
              <Pill tone="blue" size="sm">Time corrected</Pill>
            </span>
          )}
          {record.auto_clocked_out && (
            <span title="Forgot to time out — closed automatically after 8 hours, no photo or location">
              <Pill tone="amber" size="sm">Auto time-out</Pill>
            </span>
          )}
          {record.status !== "approved" && (
            <Pill tone={STATUS_TONES[record.status] ?? "slate"} className="capitalize">{record.status}</Pill>
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
            <span className="text-sm font-semibold text-slate-900">{record.hours}h</span> rendered
          </>
        ) : (
          "In progress"
        )}
      </p>

      {viewing !== null && <PhotoViewer photos={photos} index={viewing} onIndexChange={setViewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
