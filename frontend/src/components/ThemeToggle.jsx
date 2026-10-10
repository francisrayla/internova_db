"use client";

import Icon from "@/components/Icon";
import { useTheme } from "@/lib/useTheme";
import "./dash/page.css";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="k-iconbtn"
    >
      <Icon name={isDark ? "sun" : "moon"} size={16} />
    </button>
  );
}
