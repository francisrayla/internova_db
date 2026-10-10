"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Icon from "@/components/Icon";

/** Full-screen viewer for a small set of photos. `photos` is [{ url, label }];
 * `index` is which one is showing, `onIndexChange`/`onClose` are the parent's. */
export default function PhotoViewer({ photos, index, onIndexChange, onClose }) {
  const count = photos.length;
  const [failedUrl, setFailedUrl] = useState(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < count - 1) onIndexChange(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onClose, onIndexChange]);

  const photo = photos[index];
  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={photo.label ?? "Photo"}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close photo"
        className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/20 text-white hover:bg-white/30 max-sm:h-[44px] max-sm:w-[44px]"
      >
        <Icon name="x" size={22} />
      </button>

      {index > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1); }}
          aria-label="Previous photo"
          className="absolute left-4 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25 max-sm:h-[44px] max-sm:w-[44px]"
        >
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
      )}
      {index < count - 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1); }}
          aria-label="Next photo"
          className="absolute right-4 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25 max-sm:h-[44px] max-sm:w-[44px]"
        >
          <ChevronRight size={24} aria-hidden="true" />
        </button>
      )}

      <figure className="flex max-h-full max-w-full flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {failedUrl === photo.url ? (
          <div className="grid h-48 w-64 max-w-full place-items-center rounded-lg bg-white/10 px-4 text-center text-sm text-white/80">No photo (the file is not available)</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt={photo.label ?? "Photo"} className="max-h-[85vh] max-w-full rounded-lg object-contain" onError={() => setFailedUrl(photo.url)} />
        )}
        {photo.label && <figcaption className="text-sm font-medium text-white/80">{photo.label}</figcaption>}
      </figure>
    </div>
  );
}
