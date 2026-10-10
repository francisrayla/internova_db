"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Small message that floats at the bottom of the screen for a few seconds.
 * Used by the Super Admin screens (schools, billing, plans, inquiries, system settings).
 * Presentational only: the screen keeps its own message (see useSaToast).
 * Full width above the home bar on phones, bottom right on desktop; inverted ink/surface so it reads in light and dark.
 */
export default function SaToast({ msg }) {
  if (!msg) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[100] rounded-[14px] px-4 py-3 text-sm font-medium shadow-lg sm:inset-x-auto sm:bottom-6 sm:right-6 sm:max-w-sm"
      style={{ background: "var(--ui-ink)", color: "var(--ui-surface)" }}
    >
      {msg}
    </div>
  );
}

/** [message, show]: `show(text)` displays it for `ms` and restarts the timer if another toast comes first, so a newer message is never cleared early. */
export function useSaToast(ms = 3000) {
  const [msg, setMsg] = useState("");
  const timer = useRef(null);
  const show = useCallback(
    (text) => {
      clearTimeout(timer.current);
      setMsg(text);
      timer.current = setTimeout(() => setMsg(""), ms);
    },
    [ms],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return [msg, show];
}
