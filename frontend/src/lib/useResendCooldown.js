"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

// Must match RESEND_COOLDOWN_SECONDS in the backend's EmailVerificationController
// and PasswordResetController, which skip a second email inside the same window.
export const RESEND_COOLDOWN_SECONDS = 60;

// Countdown before "Resend code" can be clicked again. The end time is kept in
// localStorage per purpose + email, so refreshing the page doesn't reset it.
function storageKey(purpose, email) {
  return `internova_resend:${purpose}:${(email || "").trim().toLowerCase()}`;
}

const listeners = new Set();

function subscribe(callback) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readUntil(key) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

// For a page that sends the code and then links elsewhere (signup -> verify-email).
export function markCodeSent(purpose, email) {
  try {
    localStorage.setItem(storageKey(purpose, email), String(Date.now() + RESEND_COOLDOWN_SECONDS * 1000));
  } catch {}
  listeners.forEach((callback) => callback());
}

export default function useResendCooldown(purpose, email) {
  const key = storageKey(purpose, email);
  const until = useSyncExternalStore(subscribe, () => readUntil(key), () => 0);
  const [now, setNow] = useState(() => Date.now());
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));

  useEffect(() => {
    if (until <= Date.now()) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [until]);

  const start = useCallback(() => {
    markCodeSent(purpose, email);
    setNow(Date.now());
  }, [purpose, email]);

  return { remaining, start };
}

export function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}
