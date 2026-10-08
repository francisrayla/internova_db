"use client";

import { useId, useState } from "react";
import { clean, inputProps } from "@/lib/inputRules";
import { emailProblem } from "@/lib/emailCheck";

/**
 * Email input with a live message under it. The message appears once the
 * person leaves the box (or after a failed save, via `showErrors`) and then
 * keeps updating as they type. `serverError` is the 422 message from the
 * server (for example "Did you mean juan@gmail.com?"); it clears as soon as
 * the value changes.
 */
export default function EmailField({
  label = "Email",
  value,
  onChange,
  serverError = "",
  showErrors = false,
  help = null,
  placeholder,
  autoFocus,
  lowercase = false,
  disabled = false,
}) {
  const [blurred, setBlurred] = useState(false);
  const id = useId();
  const local = blurred || showErrors ? emailProblem(value) : "";
  const message = serverError || local;

  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-semibold text-slate-700">{label}</span>
      <input
        {...inputProps("email")}
        type="email"
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? id : undefined}
        onBlur={() => setBlurred(true)}
        onChange={(e) => {
          const next = clean("email", e.target.value);
          onChange(lowercase ? next.toLowerCase() : next);
        }}
        className={`w-full min-w-0 rounded-xl border px-3 py-2.5 text-sm outline-none ${message ? "border-red-400 focus:border-red-500" : "border-slate-300 focus:border-blue-500"} disabled:bg-slate-50 disabled:text-slate-500`}
      />
      {message ? (
        <span id={id} role="alert" className="mt-1 block break-words text-xs font-medium text-red-600">{message}</span>
      ) : (
        help && <span className="mt-1 block text-xs text-slate-400">{help}</span>
      )}
    </label>
  );
}
