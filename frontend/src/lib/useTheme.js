"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "internova_theme";

function readInitialTheme() {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Mirrors the class the inline head script (see app/layout.jsx) already
 * stamped on <html> before paint — this hook just keeps React state and the
 * DOM class in sync from here on, and persists the user's explicit choice. */
export function useTheme() {
  const [theme, setTheme] = useState(readInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  return { theme, toggleTheme, setTheme };
}
