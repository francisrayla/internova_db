"use client";

import { useEffect } from "react";

/** Full-screen viewer for a small set of photos. `photos` is [{ url, label }];
 * `index` is which one is showing, `onIndexChange`/`onClose` are the parent's. */
export default function PhotoViewer({ photos, index, onIndexChange, onClose }) {
  const count = photos.length;

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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={photo.label ?? "Photo"}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/15 text-xl leading-none text-white hover:bg-white/25"
      >
        ×
      </button>

      {index > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1); }}
          aria-label="Previous photo"
          className="absolute left-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-xl text-white hover:bg-white/25"
        >
          ‹
        </button>
      )}
      {index < count - 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1); }}
          aria-label="Next photo"
          className="absolute right-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-xl text-white hover:bg-white/25"
        >
          ›
        </button>
      )}

      <figure className="flex max-h-full max-w-full flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={photo.label ?? "Photo"} className="max-h-[85vh] max-w-full rounded-lg object-contain" />
        {photo.label && <figcaption className="text-sm font-medium text-white/80">{photo.label}</figcaption>}
      </figure>
    </div>
  );
}
