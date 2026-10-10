"use client";

import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import { initialsOf } from "@/lib/format";
import "./dash.css";

/*
 * Small kit shared by the five role dashboards. The look (colours, radii,
 * spacing) lives in ./dash.css under the `.dash` wrapper, so the dashboards
 * stay consistent and a later tweak is a one-place change.
 */

const cx = (...parts) => parts.filter(Boolean).join(" ");

/** The wrapper every dashboard renders inside; it carries the theme tokens. */
export function DashPage({ children }) {
  return <div className="dash dash-stack">{children}</div>;
}

/** Two-column area. `wide-left` gives the left column more room, `even` splits it in half. */
export function Cols({ layout = "even", children }) {
  return <div className={cx("dash-cols", layout === "wide-left" ? "is-wide-left" : "is-even")}>{children}</div>;
}

/** A stack of cards inside one column. */
export function Col({ children }) {
  return <div className="dash-col">{children}</div>;
}

/** Greeting, one human sentence, an optional small line (date) and text links on the right. */
export function DashHeader({ title, sentence, meta, children }) {
  return (
    <header className="dash-head">
      <div className="min-w-0">
        <h1>{title}</h1>
        {sentence && <p>{sentence}</p>}
        {meta && <p className="dash-date">{meta}</p>}
      </div>
      {children && <div className="dash-links">{children}</div>}
    </header>
  );
}

/** Text-style link: accent colour, optional small arrow. */
export function TextLink({ href, children, arrow = false, quiet = false, ...rest }) {
  return (
    <Link href={href} className={cx("dash-link", quiet && "is-quiet")} {...rest}>
      {children}
      {arrow && <NavIcon name="arrow" size={14} />}
    </Link>
  );
}

export function Card({ title, help, action, className, children }) {
  return (
    <section className={cx("dash-card", className)}>
      {(title || action) && (
        <div className="dash-card-head">
          <div className="min-w-0">
            {title && <h2>{title}</h2>}
            {help && <p>{help}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** One card of figures split by hairlines. items: [{ label, value, note, href, tone: "warn" | "risk" }] */
export function StatStrip({ items }) {
  return (
    <div className="dash-strip" style={{ "--cols": items.length }}>
      {items.map((item) => {
        const body = (
          <>
            <span className="dash-fig-label">{item.label}</span>
            <span className="dash-fig-value">{item.value}</span>
            {item.note && <span className={cx("dash-fig-note", item.tone && `is-${item.tone}`)}>{item.note}</span>}
          </>
        );
        return item.href ? (
          <Link key={item.label} href={item.href} className="dash-fig">{body}</Link>
        ) : (
          <div key={item.label} className="dash-fig">{body}</div>
        );
      })}
    </div>
  );
}

const BAR_COLOR = {
  ok: "var(--d-ok-bar)",
  warn: "var(--d-warn-bar)",
  risk: "var(--d-risk-bar)",
  info: "var(--d-info-bar)",
  muted: "var(--d-mute-bar)",
};

/** One bar split into parts plus a legend with the counts. segments: [{ key, label, value, tone, href }] */
export function SegmentedBar({ segments, label }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const summary = segments.map((s) => `${s.label} ${s.value}`).join(", ");
  return (
    <div>
      {total > 0 ? (
        <div className="dash-seg" role="img" aria-label={`${label}: ${summary}`}>
          {segments.filter((s) => s.value > 0).map((s) => (
            <span key={s.key} style={{ flex: `${s.value} 1 0`, background: BAR_COLOR[s.tone] }} />
          ))}
        </div>
      ) : (
        <div className="dash-seg-empty" role="img" aria-label={`${label}: nothing yet`} />
      )}
      <ul className="dash-legend">
        {segments.map((s) => {
          const inner = (
            <>
              <i style={{ background: BAR_COLOR[s.tone] }} />
              <b>{s.value}</b>
              <span className="dash-legend-label">{s.label}</span>
            </>
          );
          return (
            <li key={s.key} className={s.value === 0 ? "is-zero" : undefined}>
              {s.href ? <Link href={s.href}>{inner}</Link> : <span className="dash-legend-item">{inner}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A label, its value and a thin bar. `tone` colours the fill (default is the accent blue). */
export function ProgressRow({ label, value, of, pct, tone, help }) {
  const width = Math.min(100, Math.max(0, Number(pct) || 0));
  return (
    <div className="dash-prog">
      <div className="dash-prog-top">
        <span className="dash-prog-label">{label}</span>
        <span className="dash-prog-value">
          {value}
          {of !== undefined && <small> of {of}</small>}
        </span>
      </div>
      <Bar pct={width} tone={tone} label={label} />
      {help && <p className="dash-prog-help">{help}</p>}
    </div>
  );
}

/** Just the thin bar (used inside rows). size: "thin" | "normal" | "thick". */
export function Bar({ pct, tone, size = "normal", label }) {
  const width = Math.min(100, Math.max(0, Number(pct) || 0));
  return (
    <div
      className={cx("dash-bar", size === "thin" && "is-thin", size === "thick" && "is-thick")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
    >
      <span className={tone ? `is-${tone}` : undefined} style={{ width: `${width}%` }} />
    </div>
  );
}

/** tone: ok | warn | risk | info, or nothing for a neutral chip. */
export function StatusChip({ tone, children }) {
  return <span className={cx("dash-chip", tone && `is-${tone}`)}>{children}</span>;
}

function tintOf(name) {
  let sum = 0;
  for (const ch of String(name ?? "")) sum += ch.charCodeAt(0);
  return (sum % 5) + 1;
}

/** Initials in a calm tint chosen from the name (or the photo when there is one). */
export function InitialsAvatar({ name, url, size = 36 }) {
  const tint = tintOf(name);
  return (
    <span
      className={cx("dash-av", tint > 1 && `t${tint}`)}
      style={{ position: "relative", width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {initialsOf(name)}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ position: "absolute", inset: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
      )}
    </span>
  );
}

/** One intern (or person) with an avatar, a thin progress bar and a percentage; optional status chip. */
export function PersonRow({ name, sub, pct, chip, href, tone }) {
  const body = (
    <>
      <InitialsAvatar name={name} size={36} />
      <span className="dash-row-main">
        <span className="dash-split">
          <span className="dash-row-title">{name}</span>
          <span className="dash-row-pct">{Math.round(pct)}%</span>
        </span>
        <Bar pct={pct} size="thin" tone={tone} label={`${name} hours`} />
        <span className="dash-split" style={{ marginTop: 6 }}>
          <span className="dash-row-sub" style={{ marginTop: 0 }}>{sub}</span>
          {chip && <StatusChip tone={chip.tone}>{chip.label}</StatusChip>}
        </span>
      </span>
    </>
  );
  return href ? <Link href={href} className="dash-row">{body}</Link> : <div className="dash-row">{body}</div>;
}

/** A short message strip. tone: "risk" (default) or "warn"; onRetry adds a Try again button. */
export function Notice({ tone = "risk", onRetry, children }) {
  return (
    <div className={cx("dash-banner", tone === "warn" && "is-warn")} role="alert">
      <span>{children}</span>
      {onRetry && <button type="button" className="dash-link" onClick={onRetry} style={{ color: "inherit" }}>Try again</button>}
    </div>
  );
}

/** Loading placeholder. */
export function Skel({ height = 96 }) {
  return <div className="dash-skel" style={{ height }} aria-hidden="true" />;
}
