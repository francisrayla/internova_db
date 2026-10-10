"use client";

import { useState } from "react";
import PhotoViewer from "@/components/PhotoViewer";

/**
 * The selfies of one attendance record as small thumbnails. Clicking one opens it in a pop-up
 * (arrows move between the time-in and time-out photo). Used wherever a supervisor, coordinator
 * or Dean looks at attendance, so all three see the same thing.
 */
export default function AttendanceSelfies({ record, name, className = "" }) {
  const [index, setIndex] = useState(null);
  // Photos whose file could not be loaded (deleted or missing on the server) show a "No photo" tile instead of a broken image.
  const [broken, setBroken] = useState(() => new Set());
  const markBroken = (url) => setBroken((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));

  const when = record.attendance_date ?? record.date ?? "";
  const part = record.session_label ? ` (${record.session_label})` : "";
  const label = (kind, time) => [name, `${kind}${part}`, time, when].filter(Boolean).join(" · ");
  const photos = [
    record.clock_in_selfie_url && { url: record.clock_in_selfie_url, label: label("Time in", record.clock_in) },
    record.clock_out_selfie_url && { url: record.clock_out_selfie_url, label: label("Time out", record.clock_out) },
  ].filter(Boolean);

  if (photos.length === 0) {
    return <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-slate-100 px-0.5 text-center text-xs leading-tight text-slate-600 ${className}`}>No photo</span>;
  }

  return (
    <>
      <div className={`flex shrink-0 gap-1.5 ${className}`}>
        {photos.map((photo, i) => broken.has(photo.url) ? (
          <span key={photo.url} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-slate-100 px-0.5 text-center text-xs leading-tight text-slate-600" title={`${photo.label} (photo file not available)`}>
            No photo
          </span>
        ) : (
          <button
            key={photo.url}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`View photo: ${photo.label}`}
            title={photo.label}
            className="h-11 w-11 cursor-zoom-in overflow-hidden rounded-lg border border-slate-200 hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={photo.label} className="h-full w-full object-cover" onError={() => markBroken(photo.url)} />
          </button>
        ))}
      </div>
      {index !== null && <PhotoViewer photos={photos} index={index} onIndexChange={setIndex} onClose={() => setIndex(null)} />}
    </>
  );
}
