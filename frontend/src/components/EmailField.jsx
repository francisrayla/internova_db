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
    <label className="k-field">
      <span className="k-label">{label}</span>
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
        className="k-input min-w-0"
      />
      {message ? (
        <span id={id} role="alert" className="k-error break-words">{message}</span>
      ) : (
        help && <span className="k-hint">{help}</span>
      )}
    </label>
  );
}
