"use client";

import { useState } from "react";
import { inputProps } from "@/lib/inputRules";

// Fallback list, used until the API answers (or if it fails). The real list comes from
// the server: the course's requirements first, then the other types the school offers.
// "Other" lets the user type any other name (older free-text types still display as-is).
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

const fieldClass = "k-input";

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Document type dropdown. `value` is always the final type string the form
 * submits: the chosen option, or the typed name when "Other" is picked.
 * `options` = { required: string[], others: string[] } from /document-types;
 * without it the built-in list is offered.
 */
export default function DocumentTypeField({ value, onChange, options }) {
  const required = options?.required ?? [];
  const others = options?.others ?? DOCUMENT_TYPES.filter((t) => t !== "Other");
  const known = [...required, ...others];
  const [other, setOther] = useState(false);
  const match = known.find((t) => same(t, value));
  const selectValue = other ? "Other" : match ?? "";

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
        {required.length > 0 && (
          <optgroup label="Required for this course">
            {required.map((t) => (
              <option key={`r-${t}`} value={t}>
                {t}
              </option>
            ))}
          </optgroup>
        )}
        {required.length > 0 ? (
          <optgroup label="Other documents">
            {others.map((t) => (
              <option key={`o-${t}`} value={t}>
                {t}
              </option>
            ))}
            <option value="Other">Other (type a name)</option>
          </optgroup>
        ) : (
          <>
            {others.map((t) => (
              <option key={`o-${t}`} value={t}>
                {t}
              </option>
            ))}
            <option value="Other">Other</option>
          </>
        )}
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
