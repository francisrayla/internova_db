"use client";

import { useState } from "react";
import { inputProps } from "@/lib/inputRules";

// The first six map to sections of the narrative report; "Other" lets the
// user type any other name (older free-text types still display as-is).
export const DOCUMENT_TYPES = [
  "Endorsement Letter",
  "Brgy. Clearance",
  "Waiver",
  "Resume",
  "Certificate of Completion",
  "Performance Evaluation",
  "Memorandum of Agreement",
  "Medical Certificate",
  "Insurance",
  "Other",
];

const fieldClass = "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500";

/**
 * Document type dropdown. `value` is always the final type string the form
 * submits — the chosen option, or the typed name when "Other" is picked.
 */
export default function DocumentTypeField({ value, onChange }) {
  const known = DOCUMENT_TYPES.filter((t) => t !== "Other");
  const [other, setOther] = useState(false);
  const selectValue = other ? "Other" : known.includes(value) ? value : "";

  function handleSelect(e) {
    const picked = e.target.value;
    setOther(picked === "Other");
    onChange(picked === "Other" ? "" : picked);
  }

  return (
    <div className="space-y-2">
      <select value={selectValue} onChange={handleSelect} className={fieldClass}>
        <option value="" disabled>
          Select a document type…
        </option>
        {DOCUMENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {other && (
        <input
          {...inputProps("shortText")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type the document name"
          className={fieldClass}
          autoFocus
        />
      )}
    </div>
  );
}
