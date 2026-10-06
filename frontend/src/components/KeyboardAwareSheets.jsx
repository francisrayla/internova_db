"use client";

import { useEffect } from "react";

// Keeps the field being typed in visible above the phone keyboard inside
// modals (any element with the `sheet-panel` class, see globals.css).
//
// Android Chrome resizes the page for the keyboard (viewport
// interactive-widget=resizes-content in app/layout.jsx), so the fixed overlay
// already ends above it. iOS Safari ignores that setting and draws the keyboard
// over the page, so the visible area is measured here and published as
// --kb (space taken at the bottom) and --vv-top (how far Safari panned down);
// .sheet-overlay uses both to sit inside what can actually be seen.
export default function KeyboardAwareSheets() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;

    function centerInPanel(el) {
      const panel = el.closest(".sheet-panel");
      if (!panel) return;
      const p = panel.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const target = panel.scrollTop + (r.top - p.top) - (p.height - r.height) / 2;
      panel.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }

    function isField(el) {
      return el && el.matches?.("input, textarea, select, [contenteditable='true']") && el.closest(".sheet-panel");
    }

    function updateInsets() {
      if (!vv) return;
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--kb", `${Math.round(kb)}px`);
      root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
      if (isField(document.activeElement)) centerInPanel(document.activeElement);
    }

    // Wait for the keyboard to finish opening before measuring where to scroll.
    let timer;
    function onFocusIn(event) {
      if (!isField(event.target)) return;
      clearTimeout(timer);
      timer = setTimeout(() => centerInPanel(event.target), 300);
    }

    document.addEventListener("focusin", onFocusIn);
    vv?.addEventListener("resize", updateInsets);
    vv?.addEventListener("scroll", updateInsets);
    updateInsets();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusin", onFocusIn);
      vv?.removeEventListener("resize", updateInsets);
      vv?.removeEventListener("scroll", updateInsets);
    };
  }, []);

  return null;
}
