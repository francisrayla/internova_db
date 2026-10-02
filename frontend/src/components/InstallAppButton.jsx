"use client";

import Icon from "@/components/Icon";
import { useInstallPrompt } from "@/lib/useInstallPrompt";

/** Renders nothing until the browser tells us the app is actually
 * installable, and disappears again the moment it's installed (or the
 * install prompt gets dismissed) — see useInstallPrompt for why. */
export default function InstallAppButton({ className, iconOnly = false }) {
  const { canInstall, promptInstall } = useInstallPrompt();
  if (!canInstall) return null;

  // Display (inline-flex/grid, plus any `hidden`/breakpoint variant) and
  // sizing (padding, radius) always come from `className` rather than
  // being baked into the base string below — mixing an unconditional
  // `grid`/`inline-flex`/`px-4` here with a caller-supplied `hidden`/`px-6`
  // would leave two classes fighting over the same property, and which one
  // wins depends on Tailwind's generation order rather than source order
  // in the className string.
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={promptInstall}
        title="Download / Install App"
        aria-label="Download / Install App"
        className={`h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 ${className ?? "grid"}`}
      >
        <Icon name="download" size={16} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={promptInstall}
      className={`items-center gap-1.5 border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 ${className ?? "inline-flex rounded-xl px-4 py-2"}`}
    >
      <Icon name="download" size={16} />
      Download App
    </button>
  );
}
