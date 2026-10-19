"use client";

import Link from "next/link";

/**
 * "I agree to the Terms and Conditions and the Privacy Notice" checkbox, shared
 * by the school registration form and the invitation page. Controlled: the page
 * owns `checked`, and shows `error` after a failed submit. The whole row is the
 * touch target (44px high); the links open in a new tab so nobody loses the form.
 */
export default function TermsCheckbox({ id = "accept-terms", checked, onChange, error }) {
  const errorId = `${id}-error`;
  return (
    <div>
      <div className={`flex min-h-11 items-start gap-3 rounded-xl border px-3 py-2.5 ${error ? "border-red-400 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-blue-600"
        />
        <label htmlFor={id} className="flex-1 cursor-pointer py-0.5 text-sm leading-snug text-slate-700">
          I agree to the{" "}
          <Link href="/terms" target="_blank" rel="noopener" className="font-semibold text-blue-700 underline underline-offset-2">
            Terms and Conditions
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" target="_blank" rel="noopener" className="font-semibold text-blue-700 underline underline-offset-2">
            Privacy Notice
          </Link>
          .
        </label>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
