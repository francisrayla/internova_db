"use client";

import { useEffect } from "react";
import "./globals.css";
import "@/components/dash/dash.css";
import "@/components/dash/page.css";

// Last-resort boundary: replaces the root layout when the layout itself fails, so it brings its own
// <html>/<body>, the global stylesheet and the saved theme. Kept free of app components and the router
// on purpose, because any of those could be what broke. The prop is `retry` in Next 16.
export default function GlobalError({ error, retry }) {
  useEffect(() => {
    console.error(error);
    try {
      const stored = localStorage.getItem("internova_theme");
      const dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", dark);
    } catch {
      // keep the default look
    }
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-full bg-slate-50 text-slate-800">
        <title>Something went wrong | Internova</title>
        <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
          <div className="dash-card mx-auto flex w-full max-w-md flex-col items-center gap-5 p-6 text-center sm:p-10">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-100 text-amber-700" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Internova</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">Something went wrong</h1>
              <p className="mt-2 text-sm text-slate-600">
                The app hit an unexpected problem. Your work is safe. Try again, or go back to the home page.
              </p>
              {error?.digest ? <p className="mt-3 text-xs text-slate-500">Reference: {error.digest}</p> : null}
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" className="k-btn is-primary is-block" onClick={() => retry()}>Try again</button>
              {/* A plain link on purpose: the router may be the thing that broke. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className="k-btn is-secondary is-block">Back to home</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
