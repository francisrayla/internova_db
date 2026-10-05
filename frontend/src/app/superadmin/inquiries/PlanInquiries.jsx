"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { apiFetch } from "@/lib/apiFetch";
import Icon from "@/components/Icon";

import { inputProps } from "@/lib/inputRules";
// List price per plan + billing period. Super Admin can still apply a discount below.
const PLAN_PRICES = {
  Basic:   { monthly: 1500,  yearly: 15000 },
  Premium: { monthly: 3500,  yearly: 35000 },
};

const STATUS_META = {
  new:              { label: "New",              color: "bg-blue-100 text-blue-700",    dot: "bg-blue-500" },
  contacted:        { label: "Contacted",        color: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-500" },
  under_discussion: { label: "Under Discussion", color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  approved:         { label: "Approved",         color: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  converted:        { label: "Converted",        color: "bg-slate-200 text-slate-600",   dot: "bg-slate-400" },
  rejected:         { label: "Rejected",         color: "bg-red-100 text-red-600",       dot: "bg-red-400" },
};

const STATUS_FLOW = ["new", "contacted", "under_discussion", "approved", "converted"];

const ACTIVE_STATUSES = ["new", "contacted", "under_discussion", "approved"];
const ARCHIVE_STATUSES = ["converted", "rejected"];

const ACTIVE_TABS = ["All", "New", "Contacted", "Under Discussion", "Approved"];
const ARCHIVE_TABS = ["All", "Converted", "Rejected"];

function statusMeta(status) {
  return STATUS_META[status?.toLowerCase().replace(" ", "_")] ?? STATUS_META.new;
}

function StatusBadge({ status }) {
  const m = statusMeta(status);
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.color}`}>
      {m.label}
    </span>
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 rounded-2xl bg-slate-900 px-5 py-3 text-sm text-white shadow-lg">
      {msg}
    </div>
  );
}

// Email compose modal — sends real email via API
function EmailModal({ inquiry, onClose, onSent }) {
  const [subject, setSubject] = useState(`Re: Internova Platform Inquiry — ${inquiry.school_name}`);
  const [body, setBody] = useState(
    `Dear ${inquiry.contact_person},\n\nThank you for your interest in Internova! We have received your inquiry and would like to discuss how we can support ${inquiry.school_name}.\n\nBased on your submission, you are interested in the ${inquiry.interested_plan} plan for approximately ${inquiry.expected_interns} interns.\n\nWe would love to schedule a short demo at your convenience. Please let us know your availability.\n\nBest regards,\nInternova Team`
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  function handleSend() {
    setSending(true);
    setError("");
    apiFetch("/api/superadmin/plan-inquiries/send-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inquiry_id: inquiry.id,
        to_email:   inquiry.email,
        to_name:    inquiry.contact_person,
        school_name: inquiry.school_name,
        subject,
        body,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          onSent();
          onClose();
        } else {
          setError(data.message || "Failed to send email.");
          setSending(false);
        }
      })
      .catch(() => {
        setError("Network error. Check your email settings and try again.");
        setSending(false);
      });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Compose Email</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><Icon name="x" size={16} /></button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 px-4 py-2 text-sm">
            <span className="text-slate-500">To: </span>
            <span className="font-medium text-slate-900">{inquiry.contact_person} &lt;{inquiry.email}&gt;</span>
          </div>
          <input {...inputProps("subject")}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500"
            placeholder="Subject"
          />
          <textarea {...inputProps("message")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500 resize-none"
          />
          {error && (
            <p className="rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700">{error}</p>
          )}
          <div className="flex justify-end gap-3">
            <button onClick={onClose} disabled={sending} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
            <button
              onClick={handleSend}
              disabled={sending}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Icon name="send" size={14} />
              {sending ? "Sending…" : "Send Email"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function slugifySchoolCode(name) {
  const base = (name || "SCHOOL")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  const suffix = Math.floor(100 + Math.random() * 900);
  return `${base || "SCHOOL"}-${suffix}`;
}

// Approve School & Send Subscription Offer modal — the Dean account already exists
// from registration; this creates the school tenant and sends them an offer to accept and pay.
function guessPlanFromInterest(interestedPlan) {
  return /premium/i.test(interestedPlan || "") ? "Premium" : "Basic";
}

// Per-field limits for the approve form, applied live on every keystroke (and
// on the prefilled inquiry values) so a field can never hold more than the
// backend accepts. Mirrors the rules in convertInquiryToSchool().
const CONVERT_LIMITS = {
  school_name:    { maxLength: 150 },
  // Codes are identifiers: uppercase letters, digits and hyphens only.
  school_code:    { maxLength: 30, filter: (v) => v.toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "").replace(/-{2,}/g, "-").slice(0, 30) },
  address:        { maxLength: 255 },
  contact_email:  { maxLength: 100, filter: (v) => v.replace(/\s/g, "").slice(0, 100) },
  // PH mobile number, same format as the registration form: 11 digits.
  contact_number: { maxLength: 11, filter: (v) => v.replace(/\D/g, "").slice(0, 11) },
  agreement_note: { maxLength: 500 },
};

function applyConvertLimit(name, value) {
  const limit = CONVERT_LIMITS[name];
  if (!limit) return value;
  return limit.filter ? limit.filter(value) : value.slice(0, limit.maxLength);
}

// Peso amount: digits with at most one decimal point and 2 decimal places,
// capped at `max` so the discount can never exceed the plan price.
function sanitizeAmount(value, max) {
  let v = value.replace(/[^\d.]/g, "");
  const dot = v.indexOf(".");
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  v = v.replace(/^0+(?=\d)/, "");
  if (v !== "" && v !== "." && Number(v) > max) return String(max);
  return v;
}

const PH_MOBILE = /^\d{11}$/;
const SCHOOL_CODE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

function ConvertToSchoolModal({ inquiry, onClose, onConverted }) {
  const [form, setForm] = useState({
    school_name: applyConvertLimit("school_name", inquiry.school_name || ""),
    school_code: applyConvertLimit("school_code", slugifySchoolCode(inquiry.school_name)),
    address: applyConvertLimit("address", inquiry.address || ""),
    contact_email: applyConvertLimit("contact_email", inquiry.email || ""),
    contact_number: applyConvertLimit("contact_number", inquiry.phone || ""),
    plan_name: guessPlanFromInterest(inquiry.interested_plan),
    billing_period: "yearly",
    discount_amount: "0",
    agreement_note: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => {
      const next = { ...f, [name]: applyConvertLimit(name, value) };
      // Switching to a cheaper plan/period re-caps a discount that was valid
      // for the old price, so the field never shows more than the plan costs.
      if (name === "plan_name" || name === "billing_period") {
        const price = PLAN_PRICES[next.plan_name]?.[next.billing_period] ?? 0;
        next.discount_amount = sanitizeAmount(next.discount_amount, price);
      }
      return next;
    });
  }

  const listPrice = PLAN_PRICES[form.plan_name]?.[form.billing_period] ?? 0;
  const discount = Math.min(Number(form.discount_amount) || 0, listPrice);
  const finalAmount = Math.max(listPrice - discount, 0);
  const needsReason = discount > 0;

  function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!form.school_name.trim()) {
      setError("School Name is required.");
      return;
    }
    if (!SCHOOL_CODE.test(form.school_code)) {
      setError("School Code can only use letters, numbers and single hyphens (e.g. ABC-COLLEGE-123).");
      return;
    }
    if (form.contact_number && !PH_MOBILE.test(form.contact_number)) {
      setError("Contact Number must be exactly 11 digits (e.g. 09171234567).");
      return;
    }
    if (needsReason && !form.agreement_note.trim()) {
      setError("Please add a Discount Reason / Agreement Note when applying a discount.");
      return;
    }

    setSaving(true);

    apiFetch(`/api/superadmin/plan-inquiries/${inquiry.id}/convert-to-school`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        school_name: form.school_name.trim(),
        school_code: form.school_code,
        address: form.address.trim(),
        contact_email: form.contact_email,
        contact_number: form.contact_number,
        plan_name: form.plan_name,
        billing_period: form.billing_period,
        list_price: listPrice,
        discount_amount: discount,
        amount: finalAmount,
        agreement_note: form.agreement_note || null,
      }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.message || "Failed to create school account.");
        }
        return data;
      })
      .then((data) => {
        onConverted(data);
        onClose();
      })
      .catch((err) => {
        setError(err.message || "Something went wrong. Please try again.");
        setSaving(false);
      });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-semibold text-slate-900">Approve School & Send Subscription Offer</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><Icon name="x" size={16} /></button>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          {inquiry.contact_person} ({inquiry.email}) already registered an account. This creates the school tenant and
          links their existing login to it — no new invitation needed.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs font-semibold uppercase text-slate-500">School Details</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">School Name</label>
              <input name="school_name" value={form.school_name} onChange={handleChange} required
                maxLength={CONVERT_LIMITS.school_name.maxLength}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">School Code</label>
              <input name="school_code" value={form.school_code} onChange={handleChange} required
                autoCapitalize="characters" spellCheck={false}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:border-blue-500" />
              <p className="mt-1 text-xs text-slate-400">Letters, numbers and hyphens only.</p>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Address</label>
            <input name="address" value={form.address} onChange={handleChange}
              maxLength={CONVERT_LIMITS.address.maxLength}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Email</label>
              <input name="contact_email" type="email" value={form.contact_email} onChange={handleChange} required
                autoComplete="off" spellCheck={false}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Number</label>
              <input name="contact_number" type="tel" inputMode="numeric" value={form.contact_number} onChange={handleChange}
                placeholder="09171234567"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
              <p className="mt-1 text-xs text-slate-400">11 digits, e.g. 09171234567.</p>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <p className="text-xs font-semibold uppercase text-slate-500 mb-1">Coordinator Account</p>
            <p className="font-medium text-slate-900">{inquiry.contact_person} · {inquiry.email}</p>
            <p className="text-xs text-slate-500 mt-0.5">Password was already set during registration.</p>
          </div>

          <p className="text-xs font-semibold uppercase text-slate-500 pt-2">Agreed Subscription</p>
          <p className="text-xs text-slate-500 -mt-2">
            Their inquiry expressed interest in: <strong>{inquiry.interested_plan || "—"}</strong>. Confirm the actual plan you agreed on below.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Agreed Plan</label>
              <select name="plan_name" value={form.plan_name} onChange={handleChange}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
                <option value="Basic">Basic</option>
                <option value="Premium">Premium</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Billing Period</label>
              <select name="billing_period" value={form.billing_period} onChange={handleChange}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500">
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Plan Price</span>
              <span className="font-semibold text-slate-900">₱{listPrice.toLocaleString()}</span>
            </div>
            <div>
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm text-slate-500 shrink-0">Discount (optional)</label>
                <div className="flex items-center rounded-xl border border-slate-300 px-3 py-1.5 focus-within:border-blue-500">
                  <span className="text-sm text-slate-400">₱</span>
                  <input
                    name="discount_amount" type="text" inputMode="decimal" autoComplete="off"
                    value={form.discount_amount}
                    onChange={(e) => setForm((f) => ({ ...f, discount_amount: sanitizeAmount(e.target.value, listPrice) }))}
                    onBlur={() => setForm((f) => ({
                      ...f,
                      discount_amount: f.discount_amount === "" || f.discount_amount === "." ? "0" : String(Number(f.discount_amount)),
                    }))}
                    className="w-28 bg-transparent pl-1 text-sm text-right tabular-nums outline-none"
                  />
                </div>
              </div>
              <p className="mt-1 text-right text-xs text-slate-400">Up to ₱{listPrice.toLocaleString()}</p>
              {needsReason && (
                <input
                  name="agreement_note"
                  value={form.agreement_note}
                  maxLength={CONVERT_LIMITS.agreement_note.maxLength}
                  onChange={handleChange}
                  placeholder="Discount reason / agreement note (required)"
                  className="mt-2 w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm outline-none focus:border-amber-500"
                />
              )}
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-3 text-sm">
              <span className="font-semibold text-slate-700">Final Amount</span>
              <span className="text-lg font-bold text-blue-700">₱{finalAmount.toLocaleString()}</span>
            </div>
          </div>

          <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-800">
            This sends a subscription offer (status <strong>Awaiting Acceptance</strong>) to {inquiry.email} as the school&apos;s Dean —
            they can log in with their existing password to review, accept, and pay. The offer expires in 14 days if unanswered.
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {saving ? "Sending…" : "Approve School & Send Subscription Offer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Notes modal
function NotesModal({ inquiry, onClose, onSave }) {
  const [notes, setNotes] = useState(inquiry.notes ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Internal Notes</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><Icon name="x" size={16} /></button>
        </div>
        <textarea {...inputProps("longText")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          placeholder="Add notes about this inquiry (not visible to the school)…"
          className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-blue-500 resize-none"
        />
        <div className="mt-4 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button
            onClick={() => { onSave(notes); onClose(); }}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
          >Save Notes</button>
        </div>
      </div>
    </div>
  );
}

export default function InquiriesPage() {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("active"); // "active" | "archive"
  const [activeTab, setActiveTab] = useState("All");
  const [toast, setToast] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showConvert, setShowConvert] = useState(false);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 3500); }

  useEffect(() => {
    fetchSuperadminData("plan-inquiries")
      .then((r) => {
        const data = r.inquiries ?? [];
        setInquiries(data);
        // Auto-picking one to show in the detail pane only makes sense on
        // desktop, where the list stays visible alongside it — on mobile
        // (list and detail share one column, see below) it would skip
        // straight past the list to a detail screen on first load, with no
        // "list" state to land on at all until Back is tapped once.
        if (typeof window !== "undefined" && window.innerWidth >= 1024) {
          const firstActive = data.find((i) => ACTIVE_STATUSES.includes(i.status)) ?? data[0];
          if (firstActive) setSelected(firstActive);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function updateInquiry(id, patch) {
    setInquiries((prev) => prev.map((i) => i.id === id ? { ...i, ...patch } : i));
    setSelected((prev) => prev?.id === id ? { ...prev, ...patch } : prev);

    // Persist to database
    apiFetch(`/api/superadmin/plan-inquiries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(console.error);
  }

  // "converted" is only ever set by actually creating the school account — not a manual step.
  const MANUAL_STATUS_FLOW = ["new", "contacted", "under_discussion", "approved"];

  function advanceStatus(inquiry) {
    const idx = MANUAL_STATUS_FLOW.indexOf(inquiry.status);
    if (idx === -1 || idx >= MANUAL_STATUS_FLOW.length - 1) return;
    const next = MANUAL_STATUS_FLOW[idx + 1];
    updateInquiry(inquiry.id, { status: next });
    showToast(`Status moved to: ${next.replace("_", " ")}`);
  }

  function rejectInquiry(inquiry) {
    updateInquiry(inquiry.id, { status: "rejected" });
    showToast(`${inquiry.school_name} inquiry rejected.`);
  }

  function copyToClipboard(text, label) {
    navigator.clipboard.writeText(text).then(() => showToast(`${label} copied!`));
  }

  // Filter logic: first split by view (active pipeline vs converted/archive), then by status tab within that view
  const viewStatuses = view === "active" ? ACTIVE_STATUSES : ARCHIVE_STATUSES;
  const tabs = view === "active" ? ACTIVE_TABS : ARCHIVE_TABS;

  const filtered = inquiries
    .filter((i) => viewStatuses.includes(i.status))
    .filter((i) => {
      if (activeTab === "All") return true;
      const tabKey = activeTab.toLowerCase().replace(" ", "_");
      return i.status === tabKey;
    });

  const counts = {};
  [...ACTIVE_STATUSES, ...ARCHIVE_STATUSES].forEach((s) => {
    counts[s] = inquiries.filter((i) => i.status === s).length;
  });

  function switchView(v) {
    setView(v);
    setActiveTab("All");
    setSelected(null);
  }

  return (
    <div className="space-y-5">
      <Toast msg={toast} />
      {showEmail && selected && (
        <EmailModal
          inquiry={selected}
          onClose={() => setShowEmail(false)}
          onSent={() => {
            updateInquiry(selected.id, { status: selected.status === "new" ? "contacted" : selected.status });
            showToast(`Email sent to ${selected.contact_person} at ${selected.email}`);
          }}
        />
      )}
      {showConvert && selected && (
        <ConvertToSchoolModal
          inquiry={selected}
          onClose={() => setShowConvert(false)}
          onConverted={(data) => {
            setInquiries((prev) => prev.map((i) => i.id === selected.id ? { ...i, status: "converted", school_id: data.school_id } : i));
            setSelected((prev) => prev?.id === selected.id ? { ...prev, status: "converted", school_id: data.school_id } : prev);
            setView("archive");
            setActiveTab("All");
            showToast(data.message || "School account created.");
          }}
        />
      )}
      {showNotes && selected && (
        <NotesModal
          inquiry={selected}
          onClose={() => setShowNotes(false)}
          onSave={(notes) => {
            updateInquiry(selected.id, { notes });
            showToast("Notes saved.");
          }}
        />
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* View toggle: Active pipeline vs Converted/Archive */}
          <div className="flex w-full gap-1 rounded-xl bg-slate-100 p-1 sm:w-fit sm:gap-2">
          <button
            onClick={() => switchView("active")}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition sm:flex-none sm:px-4 ${
              view === "active" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Active Inquiries
            <span className="ml-1.5 opacity-70">
              {ACTIVE_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0)}
            </span>
          </button>
          <button
            onClick={() => switchView("archive")}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition sm:flex-none sm:px-4 ${
              view === "archive" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <span className="sm:hidden">Archive</span>
            <span className="hidden sm:inline">Converted / Archive</span>
            <span className="ml-1.5 opacity-70">
              {ARCHIVE_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0)}
            </span>
          </button>
          </div>
          <Link
            href="/inquiry"
            target="_blank"
            className="rounded-xl border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            View Public Form ↗
          </Link>
        </div>

        {/* Status sub-tabs within the current view */}
        {/* One swipeable row on phones instead of chips wrapping into a
            second and third line; wraps normally from sm up. */}
        <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 sm:mx-0 sm:flex-wrap sm:gap-3 sm:overflow-visible sm:px-0">
          {tabs.map((tab) => {
            const value = tab === "All"
              ? viewStatuses.reduce((n, s) => n + (counts[s] ?? 0), 0)
              : counts[tab.toLowerCase().replace(" ", "_")] ?? 0;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition sm:rounded-xl sm:px-4 sm:py-2 ${
                  activeTab === tab
                    ? "bg-blue-600 text-white"
                    : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {tab} <span className="ml-1 opacity-80">{value}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Two-column: list + detail */}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">

        {/* Left: inquiry list — hidden on mobile once something's selected,
            since a master-detail split only makes sense side by side; below
            lg: it's really two full-width screens, so show one at a time
            (list, then detail with a way back) instead of stacking both. */}
        <div className={`space-y-3 ${selected ? "hidden lg:block" : ""}`}>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
            ))
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              No inquiries in this category
            </div>
          ) : (
            filtered.map((inq) => {
              const isActive = selected?.id === inq.id;
              return (
                <button
                  key={inq.id}
                  onClick={() => setSelected(inq)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    isActive
                      ? "border-blue-400 bg-blue-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{inq.school_name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{inq.contact_person} · {inq.position}</p>
                    </div>
                    <StatusBadge status={inq.status} />
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Icon name="card" size={12} /> {inq.interested_plan}</span>
                    <span className="flex items-center gap-1"><Icon name="users" size={12} /> {inq.expected_interns} interns</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-slate-500">{inq.message}</p>
                  <p className="mt-2 text-xs text-slate-400">{inq.submitted_at}</p>
                </button>
              );
            })
          )}
        </div>

        {/* Right: detail panel */}
        {selected ? (
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="flex w-full items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-6 py-3 text-sm font-semibold text-blue-600 hover:text-blue-700 lg:hidden"
            >
              <Icon name="arrow" size={14} className="rotate-180" /> Back to Inquiries
            </button>
            {/* Detail header */}
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">{selected.school_name}</h3>
                  <p className="text-sm text-slate-500">{selected.school_type} · {selected.address}</p>
                </div>
                <StatusBadge status={selected.status} />
              </div>

              {/* Status timeline */}
              <div className="mt-4 flex items-center gap-1 overflow-x-auto pb-1">
                {STATUS_FLOW.map((s, idx) => {
                  const currentIdx = STATUS_FLOW.indexOf(selected.status);
                  const done = idx <= currentIdx;
                  const m = STATUS_META[s];
                  return (
                    <div key={s} className="flex items-center gap-1">
                      <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${done ? m.color : "bg-slate-100 text-slate-400"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${done ? m.dot : "bg-slate-300"}`} />
                        {m.label}
                      </div>
                      {idx < STATUS_FLOW.length - 1 && (
                        <span className={`text-xs ${done && idx < currentIdx ? "text-slate-400" : "text-slate-200"}`}>→</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {selected.status === "converted" && selected.school_id && (
                <Link
                  href={`/superadmin/schools?highlight=${selected.school_id}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline"
                >
                  <Icon name="building" size={14} /> View School Profile <Icon name="arrow" size={14} />
                </Link>
              )}
            </div>

            <div className="p-6 space-y-6">
              {/* Two-column info */}
              <div className="grid gap-6 md:grid-cols-2">

                {/* Contact info */}
                <div className="rounded-2xl bg-slate-50 p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact Person</p>
                  <div>
                    <p className="font-semibold text-slate-900">{selected.contact_person}</p>
                    <p className="text-sm text-slate-500">{selected.position}</p>
                  </div>
                  <div className="space-y-2">
                    {/* Copying either of these lives in Actions below (Reply
                        via Email, Copy Phone Number) — a second Copy button
                        right here just duplicated that. */}
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Icon name="mail" size={15} className="shrink-0 text-slate-400" />
                      <span>{selected.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Icon name="phone" size={15} className="shrink-0 text-slate-400" />
                      <span>{selected.phone}</span>
                    </div>
                  </div>
                </div>

                {/* Inquiry info */}
                <div className="rounded-2xl bg-slate-50 p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inquiry Details</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Interested Plan</span>
                      <span className="font-semibold text-slate-900">{selected.interested_plan}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Expected Interns</span>
                      <span className="font-semibold text-slate-900">{selected.expected_interns}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Coordinators</span>
                      <span className="font-semibold text-slate-900">{selected.expected_coordinators}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Heard From</span>
                      <span className="font-semibold text-slate-900">{selected.heard_from}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Submitted</span>
                      <span className="font-semibold text-slate-900">{selected.submitted_at}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Their message */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Their Message</p>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 leading-relaxed">
                  {selected.message}
                </div>
              </div>

              {/* Internal notes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Internal Notes</p>
                  <button onClick={() => setShowNotes(true)} className="text-xs font-semibold text-blue-600 hover:underline">
                    {selected.notes ? "Edit" : "+ Add note"}
                  </button>
                </div>
                {selected.notes ? (
                  <div className="rounded-2xl bg-yellow-50 border border-yellow-200 p-4 text-sm text-slate-700">
                    {selected.notes}
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNotes(true)}
                    className="w-full rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-400 hover:border-slate-400 hover:text-slate-500"
                  >
                    Click to add internal notes about this inquiry…
                  </button>
                )}
              </div>

              {/* Action buttons */}
              <div className="border-t border-slate-200 pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setShowEmail(true)}
                    className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    <Icon name="mail" size={15} /> Reply via Email
                  </button>
                  <button
                    onClick={() => copyToClipboard(selected.phone, "Phone number")}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Icon name="phone" size={15} /> Copy Phone Number
                  </button>
                  <button
                    onClick={() => advanceStatus(selected)}
                    disabled={selected.status === "converted" || selected.status === "rejected"}
                    className="flex items-center justify-center gap-2 rounded-xl border border-blue-300 px-4 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Icon name="check" size={15} /> Advance Status
                  </button>
                  <button
                    onClick={() => setShowConvert(true)}
                    disabled={selected.status === "converted"}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Icon name="building" size={15} /> Approve School & Send Offer
                  </button>
                  <button
                    onClick={() => setShowNotes(true)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Icon name="edit" size={15} /> Add / Edit Notes
                  </button>
                  <button
                    onClick={() => rejectInquiry(selected)}
                    disabled={selected.status === "rejected" || selected.status === "converted"}
                    className="flex items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Icon name="x" size={15} /> Reject Inquiry
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center lg:flex">
            <div>
              <Icon name="file" size={40} className="mx-auto text-slate-300" />
              <p className="mt-3 font-semibold text-slate-700">Select an inquiry to view details</p>
              <p className="mt-1 text-sm text-slate-500">Click any inquiry card on the left to review it.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
