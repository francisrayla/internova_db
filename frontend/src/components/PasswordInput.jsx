"use client";

import { useState } from "react";
import Icon from "@/components/Icon";

/** A password `<input>` with a show/hide toggle — used everywhere a password
 * is typed (login, reset, invite acceptance, account settings, signup) so
 * people can check what they typed before submitting, instead of guessing
 * from a row of dots. Each instance manages its own visibility; toggling one
 * field never reveals any other. */
export default function PasswordInput({ className = "", type: _type, ...props }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        // bcrypt only uses a password's first 72 bytes — typing past that
        // would silently change nothing. Callers can still pass their own.
        maxLength={72}
        autoComplete="off"
        spellCheck={false}
        {...props}
        type={visible ? "text" : "password"}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
      >
        <Icon name={visible ? "eyeOff" : "eye"} size={17} />
      </button>
    </div>
  );
}
