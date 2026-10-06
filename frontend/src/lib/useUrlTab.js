"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * The active tab lives in `?tab=`, so a link like `?tab=manage` switches tabs
 * even when you're already on the page, and Back/Forward move between tabs.
 * Returns [tab, setTab]; unknown or missing values fall back to `fallback`.
 */
export function useUrlTab(keys, fallback) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("tab");
  const tab = keys.includes(requested) ? requested : fallback;

  const setTab = useCallback(
    (key) => {
      const next = new URLSearchParams(params.toString());
      next.set("tab", key);
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [params, pathname, router]
  );

  return [tab, setTab];
}
