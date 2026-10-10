"use client";

import { useEffect, useState } from "react";

/**
 * An <img> that degrades gracefully offline: photos already seen are served
 * from the service worker's cache, and one that was never loaded on this
 * device shows a short note instead of a broken-image icon — then loads by
 * itself as soon as the connection is back.
 */
export default function OfflineImage({ src, alt, className, placeholderClassName = "" }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!failed) return;
    function retry() {
      setFailed(false);
      setAttempt((n) => n + 1);
    }
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [failed]);

  if (failed) {
    return (
      <span className={`grid h-full w-full place-items-center bg-slate-50 px-2 text-center text-xs text-slate-500 ${placeholderClassName}`}>
        {typeof navigator !== "undefined" && navigator.onLine === false ? "Photo shows when you’re online" : "No photo"}
      </span>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img key={attempt} src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
