"use client";

import { useEffect, useState } from "react";

function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

/** Wraps the browser's `beforeinstallprompt` flow — Chrome/Edge/Android fire
 * it once the PWA meets installability criteria (manifest + service worker,
 * see PwaRegister/manifest.json), and the browser suppresses its own mini-
 * infobar once we've called preventDefault(), so any install UI has to come
 * from us instead. iOS Safari never fires this event at all (no supported
 * install-prompt API there), so `canInstall` just stays false and callers
 * should hide their button rather than show something that can't work. */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    function handleBeforeInstall(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    function handleInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function promptInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // The prompt can only be used once — clear it either way so the button
    // hides itself even if the person dismissed it, matching what a native
    // install affordance (e.g. the browser's own icon) would do.
    setDeferredPrompt(null);
    if (outcome === "accepted") setInstalled(true);
  }

  return { canInstall: Boolean(deferredPrompt) && !installed, promptInstall };
}
