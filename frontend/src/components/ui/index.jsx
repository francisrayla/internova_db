"use client";

import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import "../dash/dash.css";
import "../dash/page.css";

const cx = (...parts) => parts.filter(Boolean).join(" ");

// Status chip colors shared by every Dean screen: green ok, amber needs attention, red overdue, blue info.
// The look is a soft tint (see .k-pill in components/dash/page.css); tone names are unchanged.
const TONES = {
  green: "is-ok",
  amber: "is-warn",
  red: "is-risk",
  blue: "is-info",
  slate: "",
};

export function Pill({ tone = "slate", size = "md", children, className = "" }) {
  return <span className={cx("k-pill", size === "sm" && "is-sm", TONES[tone] ?? TONES.slate, className)}>{children}</span>;
}

export function ProgressBar({ pct = 0, tone, label }) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  const color = tone === "amber" ? "is-warn" : tone === "red" ? "is-risk" : value >= 100 ? "is-ok" : "";
  return (
    <div className="k-bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span className={color} style={{ width: `${value}%` }} />
    </div>
  );
}

export function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

// One of five calm tints, chosen from the name so a person keeps their colour.
function tintOf(name) {
  let sum = 0;
  for (const ch of String(name ?? "")) sum += ch.charCodeAt(0);
  return (sum % 5) + 1;
}

// `tone="self"` pins the first (blue) tint, so a person's own profile page matches their header avatar instead of the name-based colour.
export function Avatar({ name, url, size = 40, tone }) {
  const tint = tone === "self" ? 1 : tintOf(name);
  return (
    <span
      className={cx("dash-av relative", tint > 1 && `t${tint}`)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {/* The initials sit under the photo, so a photo that is slow or broken still leaves a readable circle. */}
      {initials(name)}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      )}
    </span>
  );
}

export function SectionTitle({ title, help, action }) {
  return (
    <div className="k-section-title">
      <div>
        <h2>{title}</h2>
        {help && <p>{help}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon = "check", title, text, action }) {
  return (
    <div className="k-empty">
      <span className="k-empty-icon">
        <NavIcon name={icon} size={20} />
      </span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div className="k-empty-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`k-skel ${className}`} />;
}

export function SkeletonList({ rows = 3, height = "h-20" }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={height} />
      ))}
    </div>
  );
}

export function ErrorNote({ children, onRetry }) {
  return (
    <div className="k-note is-risk" role="alert">
      <span>{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function TabBar({ tabs, active, onChange }) {
  return (
    <div className="k-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className="k-tab"
        >
          {t.label}
          {t.count > 0 && <span className={cx("k-tab-count", t.alert && "is-alert")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function BackLink({ href, children }) {
  return (
    <Link href={href} className="dash-link">
      {children}
    </Link>
  );
}

/** Short status message (success / error / info) shown above a list. */
export function Banner({ tone = "green", children, onDismiss }) {
  const styles = {
    green: "is-ok",
    red: "is-risk",
    amber: "is-warn",
    blue: "",
  };
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cx("k-note", styles[tone] ?? "")}>
      <span className="min-w-0">{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="shrink-0">
          Dismiss
        </button>
      )}
    </div>
  );
}
