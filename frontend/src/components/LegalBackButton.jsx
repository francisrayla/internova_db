"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * "Back" on the Terms and Privacy pages goes to the screen the person came from, not always Home:
 * - came from another page of the app: back to it (jump-list clicks inside this page are skipped);
 * - opened in a new tab from a form (the Terms checkbox links): closes the tab, so the form is right there, still filled in;
 * - opened directly (typed, bookmark, email link): Home.
 */
export default function LegalBackButton() {
  const router = useRouter();
  const [mode, setMode] = useState("home"); // back | close | home

  // "On this page" jumps scroll without adding history entries, so Back always means the previous page.
  useEffect(() => {
    function jump(e) {
      const link = e.target.closest?.('a[href^="#"]');
      if (!link || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const target = document.getElementById(decodeURIComponent(link.getAttribute("href").slice(1)));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(window.history.state, "", link.getAttribute("href"));
    }
    document.addEventListener("click", jump);
    return () => document.removeEventListener("click", jump);
  }, []);

  useEffect(() => {
    let sameSiteReferrer = false;
    try {
      sameSiteReferrer = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch {
      sameSiteReferrer = false;
    }
    // Reached by a click inside the app (client navigation): the page this tab first loaded is another one.
    const firstLoad = performance.getEntriesByType("navigation")[0];
    let loadedHere = true;
    try {
      loadedHere = !firstLoad || new URL(firstLoad.name).pathname === window.location.pathname;
    } catch {
      loadedHere = true;
    }
    const next = !loadedHere
      ? "back"
      : sameSiteReferrer
        ? window.history.length > 1 ? "back" : "close" // full load from one of our pages, or a new tab from a form
        : "home"; // typed, bookmarked, from an email or another site
    // Read once after mount: history and referrer are only known in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(next);
  }, []);

  function goBack() {
    if (mode === "close") {
      // Opened in a new tab from a form: closing it shows that form again, still filled in.
      const from = document.referrer ? new URL(document.referrer) : null;
      window.close();
      // Some browsers refuse to close a tab the script did not open: go to the page it came from instead.
      setTimeout(() => router.push(from ? from.pathname + from.search : "/"), 300);
      return;
    }
    if (mode === "back") {
      router.back();
      return;
    }
    router.push("/");
  }

  return (
    <button type="button" onClick={goBack} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
    </button>
  );
}
