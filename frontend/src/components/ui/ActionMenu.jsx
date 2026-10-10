"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import "@/components/dash/page.css";

const MENU_WIDTH = 224;
const ENABLED_ITEM = '[role="menuitem"]:not([aria-disabled="true"])';

/**
 * Small accessible "more actions" menu: a button that opens a popover.
 * items: [{ key, label, icon?, href?, onSelect?, danger?, disabled? }]
 * Destructive items (danger) are always shown last, in red, after a divider.
 * Keyboard: ArrowDown/ArrowUp open, arrows/Home/End move, Escape closes and
 * returns focus to the button, Tab closes. Clicking outside closes it.
 * The popover is position:fixed so tables that scroll inside their own
 * container never clip it.
 */
export default function ActionMenu({ items, label = "More actions", text, icon = "dots", disabled = false, align = "right", className = "" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const visible = items.filter(Boolean);
  const normal = visible.filter((i) => !i.danger);
  const danger = visible.filter((i) => i.danger);
  const count = visible.length;

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Place the popover under the button (or above it when there's no room), kept inside the viewport.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? count * 40 + 16;
    const left = align === "right" ? r.right - MENU_WIDTH : r.left;
    const top = r.bottom + 6 + height > window.innerHeight && r.top - 6 - height > 0 ? r.top - 6 - height : r.bottom + 6;
    setPos({ top, left: Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8)) });
  }, [open, align, count]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector(ENABLED_ITEM)?.focus();
    function onDown(e) {
      if (menuRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  function onButtonKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onMenuKeyDown(e) {
    const nodes = Array.from(menuRef.current?.querySelectorAll(ENABLED_ITEM) ?? []);
    const idx = nodes.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      nodes[(idx + 1) % nodes.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nodes[(idx - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      nodes[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      nodes[nodes.length - 1]?.focus();
    }
  }

  if (count === 0) return null;

  const itemClass = (item) =>
    `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 max-sm:min-h-[44px] ${
      item.disabled
        ? "cursor-not-allowed text-slate-400"
        : item.danger
          ? "text-red-600 hover:bg-red-50 focus-visible:bg-red-50"
          : "text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50"
    }`;

  function renderItem(item) {
    const content = (
      <>
        {item.icon && <Icon name={item.icon} size={15} />}
        <span className="min-w-0 truncate">{item.label}</span>
      </>
    );
    if (item.href && !item.disabled) {
      return (
        <Link key={item.key} href={item.href} role="menuitem" tabIndex={-1} className={itemClass(item)} onClick={() => setOpen(false)}>
          {content}
        </Link>
      );
    }
    return (
      <button
        key={item.key}
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={item.disabled || undefined}
        className={itemClass(item)}
        onClick={() => {
          if (item.disabled) return;
          setOpen(false);
          item.onSelect?.();
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
        className={`k-btn is-secondary shrink-0 ${text ? "" : "is-icon"} ${className}`}
      >
        <Icon name={icon} size={16} />
        {text && <span>{text}</span>}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="z-[80] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
        >
          {normal.map(renderItem)}
          {normal.length > 0 && danger.length > 0 && <div role="separator" className="my-1 border-t border-slate-100" />}
          {danger.map(renderItem)}
        </div>
      )}
    </>
  );
}
