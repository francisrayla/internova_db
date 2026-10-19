"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { apiFetch } from "@/lib/apiFetch";
import Icon from "@/components/Icon";
import NavIcon from "@/components/NavIcon";
import { ExternalLink } from "lucide-react";
import { Btn, Chip, Chips, DataList, EmptyState, FilterBar, FormField, Input, KeyValueList, Page, PageHeader, Pill, Section, Select, SheetFrame, SkeletonList, TabStrip, Textarea } from "@/components/dash/page";
import SaToast, { useSaToast } from "../SaToast";
import { LoadMore } from "@/components/Pagination";

import { clean, inputProps } from "@/lib/inputRules";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
// List price per plan + billing period comes from the Plans page data (GET superadmin/plans-features);
// the shared constants are only the fallback while it loads or if it fails. Super Admin can still apply a discount below.
import { PLAN_PRICES } from "@/lib/billingConstants";
import { headTitleOf } from "@/lib/headTitle";

const STATUS_META = {
  new:              { label: "New",              tone: "blue" },
  contacted:        { label: "Contacted",        tone: "amber" },
  under_discussion: { label: "Under Discussion", tone: "slate" },
  approved:         { label: "Approved",         tone: "green" },
  converted:        { label: "Converted",        tone: "slate" },
  rejected:         { label: "Rejected",         tone: "red" },
};

// Same tone names as <Pill>, for the timeline where the chip is drawn by hand.
const TONE_CLASS = { green: "is-ok", amber: "is-warn", red: "is-risk", blue: "is-info", slate: "" };

const STATUS_FLOW = ["new", "contacted", "under_discussion", "approved", "converted"];

const PER_PAGE = 15;

const ACTIVE_STATUSES = ["new", "contacted", "under_discussion", "approved"];
const ARCHIVE_STATUSES = ["converted", "rejected"];

const ACTIVE_TABS = ["All", "New", "Contacted", "Under Discussion", "Approved"];
const ARCHIVE_TABS = ["All", "Converted", "Rejected"];

function statusMeta(status) {
  return STATUS_META[status?.toLowerCase().replace(" ", "_")] ?? STATUS_META.new;
}

function StatusBadge({ status }) {
  const m = statusMeta(status);
  return <Pill tone={m.tone} className="shrink-0 whitespace-nowrap">{m.label}</Pill>;
}

// Email compose modal — sends real email via API
function EmailModal({ inquiry, onClose, onSent }) {
  const [subject, setSubject] = useState(`Re: Internova Platform Inquiry — ${inquiry.school_name}`);
  // "Basic Plan" reads as "the Basic plan"; answers like "Not sure — I need more info" can't be dropped into that sentence.
  const planMatch = /^(Basic|Premium) Plan$/i.exec(inquiry.interested_plan || "");
  const interest = planMatch
    ? `you are interested in the ${planMatch[1]} plan for approximately ${inquiry.expected_interns} interns`
    : `you would like to learn more about Internova for approximately ${inquiry.expected_interns} interns`;
  const [body, setBody] = useState(
    `Dear ${inquiry.contact_person},\n\nThank you for your interest in Internova! We have received your inquiry and would like to discuss how we can support ${inquiry.school_name}.\n\nBased on your submission, ${interest}.\n\nWe would love to schedule a short demo at your convenience. Please let us know your availability.\n\nBest regards,\nInternova Team`
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
    <SheetFrame
      title="Compose Email"
      size="md"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={sending}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSend} disabled={sending}>
            <Icon name="send" size={14} />
            {sending ? "Sending…" : "Send Email"}
          </Btn>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="rounded-xl px-4 py-2.5 text-sm break-words" style={{ background: "var(--ui-soft)" }}>
          <span style={{ color: "var(--ui-muted)" }}>To: </span>
          <span className="font-medium" style={{ color: "var(--ui-ink)" }}>{inquiry.contact_person} &lt;{inquiry.email}&gt;</span>
        </p>
        <FormField label="Subject">
          <Input {...inputProps("subject")}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
          />
        </FormField>
        <FormField label="Message">
          <Textarea {...inputProps("message")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
          />
        </FormField>
        {error && <p className="k-note is-risk" role="alert">{error}</p>}
      </div>
    </SheetFrame>
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
  school_name:    { maxLength: 150, filter: (v) => clean("orgName", v) },
  // Codes are identifiers: uppercase letters, digits and hyphens only.
  school_code:    { maxLength: 30, filter: (v) => v.toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "").replace(/-{2,}/g, "-").slice(0, 30) },
  address:        { maxLength: 255 },
  contact_email:  { maxLength: 100, filter: (v) => clean("email", v) },
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

function ConvertToSchoolModal({ inquiry, prices, onClose, onConverted }) {
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
        const price = prices[next.plan_name]?.[next.billing_period] ?? 0;
        next.discount_amount = sanitizeAmount(next.discount_amount, price);
      }
      return next;
    });
  }

  const listPrice = prices[form.plan_name]?.[form.billing_period] ?? 0;
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
    <SheetFrame
      title="Approve School & Send Subscription Offer"
      description={`${inquiry.contact_person} (${inquiry.email}) already registered an account. This creates the school tenant and links their existing login to it — no new invitation needed.`}
      size="md"
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <Btn onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn variant="primary" type="submit" disabled={saving}>
            {saving ? "Sending…" : "Approve School & Send Subscription Offer"}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="k-label">School Details</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="School Name">
            <Input name="school_name" value={form.school_name} onChange={handleChange} required
              maxLength={CONVERT_LIMITS.school_name.maxLength} />
          </FormField>
          <FormField label="School Code" hint="Letters, numbers and hyphens only.">
            <Input name="school_code" value={form.school_code} onChange={handleChange} required
              autoCapitalize="characters" spellCheck={false} className="font-mono" />
          </FormField>
        </div>
        <FormField label="Address">
          <Input name="address" value={form.address} onChange={handleChange}
            maxLength={CONVERT_LIMITS.address.maxLength} />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Contact Email">
            <Input name="contact_email" type="email" value={form.contact_email} onChange={handleChange} required
              autoComplete="off" spellCheck={false} />
          </FormField>
          <FormField label="Contact Number" hint="11 digits, e.g. 09171234567.">
            <Input name="contact_number" type="tel" inputMode="numeric" value={form.contact_number} onChange={handleChange}
              placeholder="09171234567" />
          </FormField>
        </div>

        <div className="rounded-xl px-4 py-3 text-sm break-words" style={{ background: "var(--ui-soft)" }}>
          <p className="k-label">{headTitleOf(inquiry.position)} Account</p>
          <p className="mt-1 font-medium" style={{ color: "var(--ui-ink)" }}>{inquiry.contact_person} · {inquiry.email}</p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--ui-muted)" }}>Password was already set during registration.</p>
        </div>

        <div>
          <p className="k-label">Agreed Subscription</p>
          <p className="mt-1 text-sm" style={{ color: "var(--ui-muted)" }}>
            Their inquiry expressed interest in: <strong style={{ color: "var(--ui-ink)" }}>{inquiry.interested_plan || "—"}</strong>. Confirm the actual plan you agreed on below.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Agreed Plan">
            <Select name="plan_name" value={form.plan_name} onChange={handleChange}>
              <option value="Basic">Basic</option>
              <option value="Premium">Premium</option>
            </Select>
          </FormField>
          <FormField label="Billing Period">
            <Select name="billing_period" value={form.billing_period} onChange={handleChange}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </Select>
          </FormField>
        </div>

        <div className="grid gap-3 rounded-xl border p-4" style={{ borderColor: "var(--ui-line)" }}>
          <KeyValueList items={[{ label: "Plan Price", value: `₱${listPrice.toLocaleString()}` }]} />
          <FormField label="Discount (optional, ₱)" hint={`Up to ₱${listPrice.toLocaleString()}`}>
            <Input
              name="discount_amount" type="text" inputMode="decimal" autoComplete="off"
              value={form.discount_amount}
              onChange={(e) => setForm((f) => ({ ...f, discount_amount: sanitizeAmount(e.target.value, listPrice) }))}
              onBlur={() => setForm((f) => ({
                ...f,
                discount_amount: f.discount_amount === "" || f.discount_amount === "." ? "0" : String(Number(f.discount_amount)),
              }))}
              className="text-right tabular-nums"
            />
          </FormField>
          {needsReason && (
            <FormField label="Discount reason / agreement note" required>
              <Input
                name="agreement_note"
                value={form.agreement_note}
                maxLength={CONVERT_LIMITS.agreement_note.maxLength}
                onChange={handleChange}
                placeholder="Discount reason / agreement note (required)"
              />
            </FormField>
          )}
          <div className="flex items-baseline justify-between gap-3 pt-3" style={{ borderTop: "1px solid var(--ui-line)" }}>
            <span className="text-sm font-semibold" style={{ color: "var(--ui-ink)" }}>Final Amount</span>
            <span className="text-lg font-semibold" style={{ color: "var(--ui-accent)" }}>₱{finalAmount.toLocaleString()}</span>
          </div>
        </div>

        <p className="k-note">
          <span className="min-w-0">
            This sends a subscription offer (status <strong>Awaiting Acceptance</strong>) to {inquiry.email} as the school&apos;s {headTitleOf(inquiry.position)} —
            they can log in with their existing password to review, accept, and pay. The offer expires in 14 days if unanswered.
          </span>
        </p>

        {error && <p className="k-note is-risk" role="alert">{error}</p>}
      </div>
    </SheetFrame>
  );
}

// Notes modal
function NotesModal({ inquiry, onClose, onSave }) {
  const [notes, setNotes] = useState(inquiry.notes ?? "");
  return (
    <SheetFrame
      title="Internal Notes"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={() => { onSave(notes); onClose(); }}>Save Notes</Btn>
        </>
      }
    >
      <FormField label="Notes">
        <Textarea {...inputProps("longText")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          placeholder="Add notes about this inquiry (not visible to the school)…"
        />
      </FormField>
    </SheetFrame>
  );
}

export default function InquiriesPage() {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const requestRef = useRef(0);
  const firstLoad = useRef(true);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("active"); // "active" | "archive"
  const [activeTab, setActiveTab] = useState("All");
  const [toast, showToast] = useSaToast();
  const [showEmail, setShowEmail] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [planPrices, setPlanPrices] = useState(PLAN_PRICES);


  // Which statuses the list asks the server for: the whole view, or the one status picked in the chips.
  function statusesFor(v, tab) {
    if (tab === "All") return (v === "active" ? ACTIVE_STATUSES : ARCHIVE_STATUSES).join(",");
    return tab.toLowerCase().replace(" ", "_");
  }

  // Page 1 replaces the list (view or chip changed); a later page is appended under it.
  function load(nextPage = 1) {
    const request = ++requestRef.current; // a slower, older answer must not replace a newer one
    fetchSuperadminData(`plan-inquiries?page=${nextPage}&per_page=${PER_PAGE}&statuses=${statusesFor(view, activeTab)}`)
      .then((r) => {
        if (request !== requestRef.current) return;
        const data = r.inquiries ?? [];
        setInquiries((prev) => {
          if (nextPage === 1) return data;
          const have = new Set(prev.map((i) => i.id));
          return [...prev, ...data.filter((i) => !have.has(i.id))];
        });
        setPage(nextPage);
        setHasMore(Boolean(r.has_more));
        setTotal(r.total ?? data.length);
        setCounts(r.counts ?? {});
        // Auto-picking one to show in the detail pane only makes sense on
        // desktop, where the list stays visible alongside it — on mobile
        // (list and detail share one column, see below) it would skip
        // straight past the list to a detail screen on first load, with no
        // "list" state to land on at all until Back is tapped once.
        if (nextPage === 1 && firstLoad.current && typeof window !== "undefined" && window.innerWidth >= 1024 && data[0]) {
          setSelected(data[0]);
        }
        firstLoad.current = false;
      })
      .catch(console.error)
      .finally(() => {
        if (request !== requestRef.current) return;
        setLoading(false);
        setLoadingMore(false);
      });
  }

  useEffect(() => {
    load(1);
  }, [view, activeTab]);

  // Live list prices, so a plan edited on the Plans page is offered at its new price.
  useEffect(() => {
    fetchSuperadminData("plans-features")
      .then((r) => {
        const live = {};
        for (const p of r.plans ?? []) {
          if (p.is_active !== false) live[p.name] = { monthly: Number(p.monthly_price) || 0, yearly: Number(p.yearly_price) || 0 };
        }
        if (Object.keys(live).length > 0) setPlanPrices((prev) => ({ ...prev, ...live }));
      })
      .catch(() => {});
  }, []);

  function loadMore() {
    setLoadingMore(true);
    load(page + 1);
  }

  // The list is cut into pages by the server, so the status counts come from it too; keep them right after a local change.
  function shiftCount(from, to) {
    if (!from || !to || from === to) return;
    setCounts((c) => ({ ...c, [from]: Math.max(0, (c[from] ?? 0) - 1), [to]: (c[to] ?? 0) + 1 }));
  }

  // Shows the change at once, saves it, and puts the old values back (with an error message) if the save fails.
  // Resolves true when the server accepted the change.
  async function updateInquiry(id, patch) {
    const current = inquiries.find((i) => i.id === id) ?? (selected?.id === id ? selected : null);
    const before = current ? Object.fromEntries(Object.keys(patch).map((k) => [k, current[k]])) : null;
    if (patch.status) shiftCount(current?.status, patch.status);
    setInquiries((prev) => prev.map((i) => i.id === id ? { ...i, ...patch } : i));
    setSelected((prev) => prev?.id === id ? { ...prev, ...patch } : prev);

    try {
      const res = await apiFetch(`/api/superadmin/plan-inquiries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.message || "The change was not saved.");
      return true;
    } catch (err) {
      if (before) {
        if (patch.status) shiftCount(patch.status, before.status);
        setInquiries((prev) => prev.map((i) => i.id === id ? { ...i, ...before } : i));
        setSelected((prev) => prev?.id === id ? { ...prev, ...before } : prev);
      }
      showToast(`Could not save: ${err.message || "check your connection and try again."}`);
      return false;
    }
  }

  // "converted" is only ever set by actually creating the school account — not a manual step.
  const MANUAL_STATUS_FLOW = ["new", "contacted", "under_discussion", "approved"];

  async function advanceStatus(inquiry) {
    const idx = MANUAL_STATUS_FLOW.indexOf(inquiry.status);
    if (idx === -1 || idx >= MANUAL_STATUS_FLOW.length - 1) return;
    const next = MANUAL_STATUS_FLOW[idx + 1];
    if (await updateInquiry(inquiry.id, { status: next })) showToast(`Status moved to: ${next.replace("_", " ")}`);
  }

  async function rejectInquiry(inquiry) {
    setRejecting(false);
    if (await updateInquiry(inquiry.id, { status: "rejected" })) showToast(`${inquiry.school_name} inquiry rejected.`);
  }

  function copyToClipboard(text, label) {
    if (!navigator.clipboard?.writeText) {
      showToast("Could not copy. Select the text and copy it by hand.");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => showToast(`${label} copied!`),
      () => showToast("Could not copy. Select the text and copy it by hand."),
    );
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

  function switchView(v) {
    setLoading(true);
    setView(v);
    setActiveTab("All");
    setSelected(null);
  }

  function pickTab(tab) {
    setLoading(true);
    setActiveTab(tab);
  }

  const activeTotal = ACTIVE_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const archiveTotal = ARCHIVE_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0);

  return (
    <Page size="wide">
      <SaToast msg={toast} />
      {showEmail && selected && (
        <EmailModal
          inquiry={selected}
          onClose={() => setShowEmail(false)}
          onSent={() => {
            // The server already moves "new" to "contacted" when it sends the reply; mirror it on screen. Any other status stays as it is.
            if (selected.status === "new") updateInquiry(selected.id, { status: "contacted" });
            showToast(`Email sent to ${selected.contact_person} at ${selected.email}`);
          }}
        />
      )}
      {showConvert && selected && (
        <ConvertToSchoolModal
          inquiry={selected}
          prices={planPrices}
          onClose={() => setShowConvert(false)}
          onConverted={(data) => {
            shiftCount(selected.status, "converted");
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
            updateInquiry(selected.id, { notes }).then((ok) => ok && showToast("Notes saved."));
          }}
        />
      )}

      <ConfirmDialog
        open={rejecting && !!selected}
        title="Reject this inquiry?"
        confirmLabel="Reject inquiry"
        onConfirm={() => selected && rejectInquiry(selected)}
        onCancel={() => setRejecting(false)}
      >
        <p>{selected?.school_name} will move to the Archive as rejected. The school is not emailed.</p>
      </ConfirmDialog>

      <PageHeader
        title="Plan Inquiries"
        sentence="Schools that asked about Internova. Reply, approve and send a subscription offer, or reject."
      >
        <Btn href="/inquiry" target="_blank">
          View Public Form <ExternalLink size={15} aria-hidden="true" />
        </Btn>
      </PageHeader>

      <FilterBar>
        <TabStrip
          label="Inquiry view"
          active={view}
          onChange={switchView}
          tabs={[
            { key: "active", label: "Active Inquiries", count: activeTotal },
            { key: "archive", label: <><span className="sm:hidden">Archive</span><span className="hidden sm:inline">Converted / Archive</span></>, count: archiveTotal },
          ]}
        />
        {/* One swipeable row on phones instead of chips wrapping into a
            second and third line; wraps normally from sm up. */}
        <Chips label="Filter by status">
          {tabs.map((tab) => {
            const value = tab === "All"
              ? viewStatuses.reduce((n, s) => n + (counts[s] ?? 0), 0)
              : counts[tab.toLowerCase().replace(" ", "_")] ?? 0;
            return (
              <Chip key={tab} on={activeTab === tab} count={value} onClick={() => pickTab(tab)}>
                {tab}
              </Chip>
            );
          })}
        </Chips>
      </FilterBar>

      {/* Two-column: list + detail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">

        {/* Left: inquiry list — hidden on mobile once something's selected,
            since a master-detail split only makes sense side by side; below
            lg: it's really two full-width screens, so show one at a time
            (list, then detail with a way back) instead of stacking both. */}
        <Section flush className={selected ? "hidden lg:block" : ""}>
          {loading ? (
            <div className="k-pad"><SkeletonList rows={3} height="h-24" /></div>
          ) : filtered.length === 0 ? (
            <div className="k-pad">
              <EmptyState icon="inquiries" title="No inquiries in this category" text="New requests from the public form show up here." />
            </div>
          ) : (
            <DataList>
              {filtered.map((inq) => {
                const isActive = selected?.id === inq.id;
                return (
                  <li key={inq.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(inq)}
                      aria-pressed={isActive}
                      className={`k-row w-full items-start text-left ${isActive ? "bg-blue-50" : ""}`}
                    >
                      <span className="k-row-main">
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block break-words font-semibold" style={{ color: "var(--ui-ink)" }}>{inq.school_name}</span>
                            <span className="block text-xs" style={{ color: "var(--ui-muted)" }}>{inq.contact_person} · {inq.position}</span>
                          </span>
                          <StatusBadge status={inq.status} />
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--ui-muted)" }}>
                          <span className="flex items-center gap-1"><Icon name="card" size={12} /> {inq.interested_plan}</span>
                          <span className="flex items-center gap-1"><Icon name="users" size={12} /> {inq.expected_interns} interns</span>
                        </span>
                        <span className="mt-2 line-clamp-2 block text-xs" style={{ color: "var(--ui-muted)" }}>{inq.message}</span>
                        <span className="mt-2 block text-xs" style={{ color: "var(--ui-muted)" }}>{inq.submitted_at}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </DataList>
          )}
          {!loading && <LoadMore shown={filtered.length} total={total} hasMore={hasMore} loading={loadingMore} onClick={loadMore} />}
        </Section>

        {/* Right: detail panel */}
        {selected ? (
          <section className="dash-card is-flush min-w-0">
            <button type="button" onClick={() => setSelected(null)} className="k-back px-4 pt-2 lg:hidden">
              <NavIcon name="back" size={16} /> Back to Inquiries
            </button>
            {/* Detail header */}
            <div className="k-pad" style={{ borderBottom: "1px solid var(--ui-line)" }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words text-xl font-semibold" style={{ color: "var(--ui-ink)" }}>{selected.school_name}</h2>
                  <p className="text-sm break-words" style={{ color: "var(--ui-muted)" }}>{selected.school_type} · {selected.address}</p>
                </div>
                <StatusBadge status={selected.status} />
              </div>

              {/* Status timeline */}
              <ol className="no-scrollbar mt-4 flex items-center gap-1.5 overflow-x-auto pb-1" aria-label="Inquiry progress">
                {STATUS_FLOW.map((s, idx) => {
                  const currentIdx = STATUS_FLOW.indexOf(selected.status);
                  const done = idx <= currentIdx;
                  const m = STATUS_META[s];
                  return (
                    <li key={s} className="flex shrink-0 items-center gap-1.5" aria-current={idx === currentIdx ? "step" : undefined}>
                      <span className={`k-pill ${done ? TONE_CLASS[m.tone] : ""}`} style={done ? undefined : { opacity: 0.75 }}>
                        {m.label}
                      </span>
                      {idx < STATUS_FLOW.length - 1 && <NavIcon name="arrow" size={12} />}
                    </li>
                  );
                })}
              </ol>

              {selected.status === "converted" && selected.school_id && (
                <Link
                  href={`/superadmin/schools?highlight=${selected.school_id}`}
                  className="dash-link mt-3 inline-flex min-h-[44px] items-center gap-1.5 sm:min-h-0"
                >
                  <Icon name="building" size={14} /> View School Profile <Icon name="arrow" size={14} />
                </Link>
              )}
            </div>

            <div className="k-pad grid grid-cols-1 gap-6">
              {/* Two-column info */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">

                {/* Contact info */}
                <div className="min-w-0">
                  <h3 className="k-label">Contact Person</h3>
                  <div className="mt-2">
                    <p className="font-semibold" style={{ color: "var(--ui-ink)" }}>{selected.contact_person}</p>
                    <p className="text-sm" style={{ color: "var(--ui-muted)" }}>{selected.position}</p>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {/* Copying either of these lives in Actions below (Reply
                        via Email, Copy Phone Number) — a second Copy button
                        right here just duplicated that. */}
                    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--ui-ink)" }}>
                      <Icon name="mail" size={15} className="shrink-0" />
                      <span className="min-w-0 break-all">{selected.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--ui-ink)" }}>
                      <Icon name="phone" size={15} className="shrink-0" />
                      <span>{selected.phone}</span>
                    </div>
                  </div>
                </div>

                {/* Inquiry info */}
                <div className="min-w-0">
                  <h3 className="k-label">Inquiry Details</h3>
                  <KeyValueList
                    className="mt-1"
                    items={[
                      { label: "Interested Plan", value: selected.interested_plan },
                      { label: "Expected Interns", value: selected.expected_interns },
                      { label: "Coordinators", value: selected.expected_coordinators ?? "—" },
                      { label: "Heard From", value: selected.heard_from || "—" },
                      { label: "Submitted", value: selected.submitted_at },
                    ]}
                  />
                </div>
              </div>

              {/* Their message */}
              <div>
                <h3 className="k-label mb-2">Their Message</h3>
                <p className="whitespace-pre-line break-words rounded-xl px-4 py-3 text-sm leading-relaxed" style={{ background: "var(--ui-soft)", color: "var(--ui-ink)" }}>
                  {selected.message}
                </p>
              </div>

              {/* Internal notes */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="k-label">Internal Notes</h3>
                  <button type="button" onClick={() => setShowNotes(true)} className="dash-link min-h-[44px] sm:min-h-0">
                    {selected.notes ? "Edit" : "+ Add note"}
                  </button>
                </div>
                {selected.notes ? (
                  <p className="k-note is-warn whitespace-pre-line break-words">{selected.notes}</p>
                ) : (
                  <Btn block onClick={() => setShowNotes(true)}>
                    Click to add internal notes about this inquiry…
                  </Btn>
                )}
              </div>

              {/* Action buttons */}
              <div className="pt-4" style={{ borderTop: "1px solid var(--ui-line)" }}>
                <h3 className="k-label mb-3">Actions</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                  <Btn variant="primary" onClick={() => setShowEmail(true)}>
                    <Icon name="mail" size={15} /> Reply via Email
                  </Btn>
                  <Btn onClick={() => copyToClipboard(selected.phone, "Phone number")}>
                    <Icon name="phone" size={15} /> Copy Phone Number
                  </Btn>
                  <Btn
                    onClick={() => advanceStatus(selected)}
                    disabled={selected.status === "converted" || selected.status === "rejected"}
                  >
                    <Icon name="check" size={15} /> Advance Status
                  </Btn>
                  <Btn
                    onClick={() => setShowConvert(true)}
                    disabled={selected.status === "converted"}
                  >
                    <Icon name="building" size={15} /> Approve School & Send Offer
                  </Btn>
                  <Btn onClick={() => setShowNotes(true)}>
                    <Icon name="edit" size={15} /> Add / Edit Notes
                  </Btn>
                  <Btn
                    variant="danger-quiet"
                    onClick={() => setRejecting(true)}
                    disabled={selected.status === "rejected" || selected.status === "converted"}
                  >
                    <Icon name="x" size={15} /> Reject Inquiry
                  </Btn>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <div className="hidden lg:block">
            <Section>
              <EmptyState icon="file" title="Select an inquiry to view details" text="Click any inquiry card on the left to review it." />
            </Section>
          </div>
        )}
      </div>
    </Page>
  );
}
