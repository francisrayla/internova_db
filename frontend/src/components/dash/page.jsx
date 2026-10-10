"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import "./dash.css";
import "./page.css";

/*
 * Page kit: the shared pieces every non-dashboard screen is built from.
 * Presentational only: no data fetching, no state, no side effects. Pages keep
 * their own handlers and pass them in (onClick, onChange, onClose ...).
 * Styles live in ./page.css (and ./dash.css for cards, chips, avatars, bars).
 * See STYLEGUIDE.md in this folder for when to use which piece.
 */

const cx = (...parts) => parts.filter(Boolean).join(" ");

// Re-exported so a page imports everything from one place.
export { Card, TextLink, StatStrip, SegmentedBar, ProgressRow, Bar, StatusChip, InitialsAvatar, PersonRow, Notice, Skel } from "./index";
export { Pill, Avatar, EmptyState, SkeletonList, Skeleton, ErrorNote, Banner, ProgressBar, TabBar, BackLink } from "@/components/ui";

/** Wrapper of a whole page: vertical rhythm and a readable width. size: "normal" (1120) | "wide" (1360) | "narrow" (760) | "full". */
export function Page({ size = "normal", className, children }) {
  return <div className={cx("k-page", size !== "normal" && `is-${size}`, className)}>{children}</div>;
}

/** Page title as a sentence-style header. `back` = { href, label }; children are the action buttons (they wrap on phones). */
export function PageHeader({ title, sentence, meta, back, children }) {
  return (
    <header className="k-head">
      <div className="k-head-text">
        {back && (
          <Link href={back.href} className="k-back">
            <NavIcon name="back" size={16} />
            {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {sentence && <p>{sentence}</p>}
        {meta && <p className="k-meta">{meta}</p>}
      </div>
      {children && <div className="k-actions">{children}</div>}
    </header>
  );
}

/** A card with a title. `flush` removes the body padding for tables and row lists. */
export function Section({ title, help, action, flush = false, className, children }) {
  return (
    <section className={cx("dash-card", flush && "is-flush", className)}>
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

/** Small heading above a group of cards (not inside one). */
export function GroupTitle({ title, help, action }) {
  return (
    <div className="k-section-title">
      <div className="min-w-0">
        <h2>{title}</h2>
        {help && <p>{help}</p>}
      </div>
      {action}
    </div>
  );
}

/** Class string of a button, for places that need a <button>/<Link>/<a> of their own. variant: primary | secondary | ghost | danger | danger-quiet. */
export function btnClass(variant = "secondary", { sm = false, block = false, className } = {}) {
  return cx("k-btn", `is-${variant}`, sm && "is-sm", block && "is-block", className);
}

/** Button, or a Link when `href` is given. */
export function Btn({ variant = "secondary", sm, block, href, className, children, ...rest }) {
  const cls = btnClass(variant, { sm, block, className });
  if (href) {
    return (
      <Link href={href} className={cls} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}

/** Label above a control, optional hint and error under it. The control goes inside, so the label is tied to it. */
export function FormField({ label, hint, error, required, className, children }) {
  return (
    <label className={cx("k-field", className)}>
      {label && (
        <span className="k-label">
          {label}
          {required && <span className="k-req" aria-hidden="true">*</span>}
        </span>
      )}
      {children}
      {hint && <span className="k-hint">{hint}</span>}
      {error && <span className="k-error" role="alert">{error}</span>}
    </label>
  );
}

export function Input({ className, ...props }) {
  return <input className={cx("k-input", className)} {...props} />;
}
export function Select({ className, children, ...props }) {
  return (
    <select className={cx("k-input", className)} {...props}>
      {children}
    </select>
  );
}
export function Textarea({ className, ...props }) {
  return <textarea className={cx("k-input", className)} {...props} />;
}

/** Search box with a magnifier. Pass value / onChange / placeholder like a normal input. */
export function SearchField({ className, ...props }) {
  return (
    <div className={cx("k-search", className)}>
      <NavIcon name="search" size={16} />
      <input type="text" className="k-input" aria-label={props.placeholder} {...props} />
    </div>
  );
}

/** Row of search, selects and chips above a list. Wraps on phones: search on its own row, selects two per row, chips scroll sideways. */
export function FilterBar({ className, children }) {
  return <div className={cx("k-filters", className)}>{children}</div>;
}

/** Chips row (inside a FilterBar or alone). */
export function Chips({ label, children }) {
  return (
    <div className="k-chips" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** One filter chip. `on` marks the chosen one. */
export function Chip({ on = false, count, children, ...rest }) {
  return (
    <button type="button" aria-pressed={on} className={cx("k-chip", on && "is-on")} {...rest}>
      {children}
      {count !== undefined && count !== null && <small>{count}</small>}
    </button>
  );
}

/** Underlined tabs. tabs: [{ key, label, count, alert, href }]. Buttons by default; items with `href` render as links. */
export function TabStrip({ tabs, active, onChange, label }) {
  return (
    <div className="k-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const on = active === t.key;
        const inner = (
          <>
            {t.label}
            {t.count > 0 && <span className={cx("k-tab-count", t.alert && "is-alert")}>{t.count}</span>}
          </>
        );
        return t.href ? (
          <Link key={t.key} href={t.href} role="tab" aria-selected={on} className="k-tab">
            {inner}
          </Link>
        ) : (
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange?.(t.key)} className="k-tab">
            {inner}
          </button>
        );
      })}
    </div>
  );
}

/** Hairline-separated list of rows. */
export function DataList({ children, className }) {
  return <ul className={cx("k-list", className)}>{children}</ul>;
}

/**
 * One row: lead (avatar/icon), title + sub, side (chip / figure), actions (buttons or an ActionMenu).
 * `href` makes the whole row a link; `onClick` makes it a button. Actions wrap under the text on phones.
 */
export function DataRow({ lead, title, sub, side, actions, href, onClick, wrap = false }) {
  const body = (
    <>
      {lead}
      <span className="k-row-main">
        <span className="k-row-title">{title}</span>
        {sub && <span className="k-row-sub">{sub}</span>}
      </span>
      {side && <span className="k-row-side">{side}</span>}
    </>
  );
  const cls = cx("k-row", wrap && "is-wrap", actions && "has-actions");
  if (actions) {
    // Actions must not sit inside a link/button, so the row is a plain box and the text part is the link.
    const main = href ? (
      <Link href={href} className="k-row-link" style={{ display: "contents", color: "inherit", textDecoration: "none" }}>{body}</Link>
    ) : onClick ? (
      <button type="button" onClick={onClick} style={{ display: "contents", color: "inherit", textAlign: "left" }}>{body}</button>
    ) : body;
    return (
      <li>
        <div className={cls}>
          {main}
          <div className="k-row-actions">{actions}</div>
        </div>
      </li>
    );
  }
  if (href) return <li><Link href={href} className={cls}>{body}</Link></li>;
  if (onClick) return <li><button type="button" onClick={onClick} className={cx(cls, "w-full text-left")}>{body}</button></li>;
  return <li><div className={cls}>{body}</div></li>;
}

/** Label / value pairs. items: [{ label, value }]. Stacks label above value on narrow screens. */
export function KeyValueList({ items, className }) {
  return (
    <dl className={cx("k-kv", className)}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Scroll container for a table. Put it inside <Section flush>. Give the <table> className="k-table" (+ "is-stack" and data-label on cells to stack into cards on phones). */
export function TableWrap({ children }) {
  return <div className="k-tablewrap">{children}</div>;
}

/**
 * Modal chrome: bottom sheet on phones, centered dialog on desktop. Header, scrolling body, footer buttons
 * (stacked full-width on phones). `aside` is a small note next to the title (e.g. "Step 1 of 2").
 * Pass `onSubmit` to make the whole panel a <form>, so a submit button in `footer` works.
 * `dismissOnOverlay` closes it when the dimmed area is pressed (only if the screen did that before).
 */
export function SheetFrame({ title, description, aside, onClose, dismissOnOverlay = false, onSubmit, closeLabel = "Close", size = "sm", footer, children, labelledBy, zIndex, noValidate }) {
  const Panel = onSubmit ? "form" : "div";
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  // Escape closes the sheet (when it can be closed) unless a confirm dialog is open on top of it.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape" || e.defaultPrevented || !closeRef.current) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      const sheets = document.querySelectorAll(".k-sheet");
      if (sheets[sheets.length - 1] !== panelRef.current) return; // only the top-most sheet
      closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // Focus goes into the sheet when it opens (on the panel itself, so a phone keyboard does not pop up), Tab
  // stays inside the top-most sheet, and focus returns to whatever opened it when it closes.
  useEffect(() => {
    const previous = document.activeElement;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    function onTab(e) {
      if (e.key !== "Tab" || !panel) return;
      const sheets = document.querySelectorAll(".k-sheet");
      if (sheets[sheets.length - 1] !== panel || document.querySelector('[role="alertdialog"]')) return;
      const nodes = Array.from(panel.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onTab);
    return () => {
      document.removeEventListener("keydown", onTab);
      if (previous instanceof HTMLElement && previous !== document.body && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="sheet-overlay k-sheet-overlay" style={zIndex ? { zIndex } : undefined} onMouseDown={(e) => dismissOnOverlay && e.target === e.currentTarget && onClose?.()}>
      <Panel ref={panelRef} onSubmit={onSubmit} noValidate={onSubmit ? noValidate : undefined} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : title} tabIndex={-1} className={cx("sheet-panel k-sheet outline-none", size !== "sm" && `is-${size}`)}>
        <div className="k-sheet-head">
          <div className="min-w-0">
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {aside && <span className="k-sheet-aside">{aside}</span>}
          {onClose && (
            <button type="button" className="k-close" onClick={onClose} aria-label={closeLabel}>
              <NavIcon name="close" size={20} />
            </button>
          )}
        </div>
        <div className="k-sheet-body">{children}</div>
        {footer && <div className="k-sheet-foot">{footer}</div>}
      </Panel>
    </div>
  );
}
