"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * True only after the client has hydrated — for components that need to
 * portal to document.body (not available during SSR) without a
 * flash-of-wrong-content mismatch. Implemented via useSyncExternalStore
 * instead of the more common `useState(false)` + `useEffect(() =>
 * setMounted(true))` pair specifically because that pair trips the
 * react-hooks/set-state-in-effect lint rule — this hook reports the same
 * false-during-SSR/true-after-hydration value without ever calling setState
 * inside an effect body.
 */
export function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}
