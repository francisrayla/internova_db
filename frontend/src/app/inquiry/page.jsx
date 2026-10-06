"use client";

import { useState } from "react";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";
import AddressPicker from "@/components/AddressPicker";

import { INPUT_RULES } from "@/lib/inputRules";
import { markCodeSent } from "@/lib/useResendCooldown";
// Only school types that actually run OJT/internship programs — basic
// education (elementary/high school) doesn't, so it's excluded here rather
// than accepted and rejected later during review.
const SCHOOL_TYPES = ["Public College/University", "Private College/University", "Technical/Vocational Institution", "Other"];
// The person filling this in becomes the school's Dean: the account owner who accepts the plan, pays and invites the coordinator.
const POSITIONS = ["Dean", "Principal", "School Head"];
const HEARD_FROM = ["Social Media (Facebook, LinkedIn)", "Google Search", "Referral from another school", "Conference / CHED Event", "Colleague / Friend", "Other"];
const PLANS = ["Basic Plan", "Premium Plan", "Not sure — I need more info", "I'd like a free demo first"];
const INTERN_RANGES = ["Less than 50", "50 – 100", "101 – 200", "201 – 500", "More than 500"];

const EMPTY = {
  school_name: "", school_type: "", address: "", website: "",
  contact_person: "", position: "", email: "", phone: "",
  intern_range: "", expected_coordinators: "", interested_plan: "",
  heard_from: "", message: "",
  password: "", password_confirmation: "",
};

// Field-specific input constraints, applied both as HTML attributes (maxLength,
// inputMode) and as a live keystroke filter (onChange) — the attributes alone
// don't stop someone from pasting or typing letters into a "numbers only"
// field, so both are needed together.
// Clamps a digit-only string to `max` numerically, not just by character
// count — "999" would otherwise pass a maxLength=3 check while still being
// way over a field whose real ceiling is, say, 500.
function digitFilter(maxLength, max) {
  return (v) => {
    const digits = v.replace(/\D/g, "").slice(0, maxLength);
    if (digits === "") return "";
    return String(Math.min(max, parseInt(digits, 10)));
  };
}

// Shared presets from lib/inputRules (same rules as every other form);
// the inquiry-only fields keep their own entries.
const FIELD_LIMITS = {
  phone: INPUT_RULES.phone,
  school_name: INPUT_RULES.orgName,
  contact_person: INPUT_RULES.fullName,
  position: INPUT_RULES.position,
  website: INPUT_RULES.url,
  email: INPUT_RULES.email,
  // bcrypt (this app's password hasher) only uses a password's first 72
  // bytes — anything typed past that is silently ignored at hash time, so
  // letting someone type further would just mislead them about what their
  // actual password is.
  password: INPUT_RULES.password,
  password_confirmation: INPUT_RULES.password,
  expected_coordinators: { maxLength: 3, filter: digitFilter(3, 500) },
};

const errorBorder = "border-red-400 focus:border-red-500 focus:ring-red-100";
const normalBorder = "border-slate-300 focus:border-blue-500 focus:ring-blue-200";

function Field({ label, name, value, onChange, type = "text", placeholder, required, invalid, invalidMessage, ...rest }) {
  const InputComponent = type === "password" ? PasswordInput : "input";
  const limit = FIELD_LIMITS[name];
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <InputComponent
        type={type}
        name={name}
        value={value}
        onChange={limit?.filter ? (e) => onChange({ target: { name, value: limit.filter(e.target.value).slice(0, limit.maxLength) } }) : onChange}
        placeholder={placeholder}
        required={required}
        // Only set the raw maxLength when there's no filter — otherwise the
        // browser truncates the RAW pasted text before the filter ever runs
        // (e.g. pasting "+63 917 123 4567" would get chopped to "+63 917 12"
        // first, losing digits, instead of the filter stripping the non-digit
        // characters and keeping all 11). The filter enforces its own length.
        maxLength={limit?.filter ? undefined : limit?.maxLength}
        inputMode={limit?.inputMode}
        autoComplete={limit?.autoComplete}
        className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-1 ${invalid ? errorBorder : normalBorder}`}
        {...rest}
      />
      {invalid && <p className="mt-1 text-xs font-medium text-red-600">{invalidMessage || "This field is required."}</p>}
      {name === "phone" && !invalid && <p className="mt-1 text-xs text-slate-400">11 digits, e.g. 09171234567.</p>}
    </div>
  );
}

function Select({ label, name, value, onChange, options, required, invalid }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none appearance-none ${invalid ? errorBorder : normalBorder}`}
      >
        <option value="">Select an option…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {invalid && <p className="mt-1 text-xs font-medium text-red-600">This field is required.</p>}
    </div>
  );
}

const REQUIRED_FIELDS = [
  "school_name", "school_type", "address", "contact_person", "position",
  "email", "phone", "intern_range", "interested_plan", "message",
  "password", "password_confirmation",
];

export default function InquiryPage() {
  const [form, setForm] = useState(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [error, setError] = useState("");
  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const isInvalid = (name) => submitAttempted && !form[name].trim();

  function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitAttempted(true);

    const missing = REQUIRED_FIELDS.some((name) => !form[name].trim());
    if (missing) {
      setError("Please fill in all required fields, marked in red below.");
      return;
    }
    if (form.phone.length !== 11) {
      setError("Contact number must be exactly 11 digits.");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (form.password !== form.password_confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);

    fetch('/api/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Something went wrong. Please try again.');
        return data;
      })
      .then(() => {
        markCodeSent("verify", form.email);
        setSubmitted(true);
      })
      .catch((err) => {
        setSaving(false);
        setError(err.message);
      });
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-3xl bg-white p-10 shadow-xl text-center">
          <div className="text-6xl">✅</div>
          <h2 className="mt-5 text-2xl font-bold text-slate-900">Registration Submitted!</h2>
          <p className="mt-3 text-slate-600">
            Thank you, <strong>{form.contact_person}</strong>! We have received your registration for <strong>{form.school_name}</strong>.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            We sent a 6-digit verification code to <strong>{form.email}</strong> — verify it before you can log in.
          </p>
          <div className="mt-6 rounded-2xl bg-blue-50 p-4 text-sm text-blue-800 text-left space-y-1">
            <p className="font-semibold">What happens next?</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-700 mt-1">
              <li>Verify your email with the code we just sent</li>
              <li>Our team reviews your registration (usually within 1–2 business days)</li>
              <li>We may reach out to discuss your needs and plan</li>
              <li>Once approved, your school account is created</li>
              <li>Log in with the same email and password to complete payment</li>
              <li>Your dashboard opens as soon as payment is confirmed</li>
            </ol>
          </div>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link
              href={`/verify-email?email=${encodeURIComponent(form.email)}`}
              className="inline-block rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Verify Your Email
            </Link>
            <Link
              href="/"
              className="inline-block rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white py-12 px-4">
      <div className="mx-auto max-w-2xl">

        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          ← Back to Home
        </Link>

        {/* Brand header */}
        <div className="text-center mb-8 mt-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700 mb-4">
            🎓 Internova — Internship Management Platform
          </div>
          <h1 className="text-3xl font-bold text-slate-900">School Registration</h1>
          <p className="mt-2 text-slate-600 max-w-lg mx-auto">
            Register your school and tell us about your internship program. The person registering becomes the school&apos;s
            Dean (or Principal): you&apos;ll be able to log in right away to check your status, and you accept the plan and pay once
            our team approves your school. You then invite your school&apos;s coordinator.
          </p>
        </div>

        {/* Contact info box */}
        <div className="mb-6 rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-700 mb-3">You can also reach us directly:</p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <span>✉️</span>
              <a href="mailto:hello@internova.ai" className="hover:underline text-blue-700">hello@internova.ai</a>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <span>📱</span>
              <a href="tel:+639171234567" className="hover:underline text-blue-700">+63 917 123 4567</a>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <span>💬</span>
              <span>Facebook: @internova.ai</span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <span>🌐</span>
              <span>internova.ai</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-6">

          {/* School info */}
          <div className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-900">School Information</h3>
            <Field label="School Name" name="school_name" value={form.school_name} onChange={handleChange} placeholder="e.g. PMFTCI" required invalid={isInvalid("school_name")} />
            <Select label="School Type" name="school_type" value={form.school_type} onChange={handleChange} options={SCHOOL_TYPES} required invalid={isInvalid("school_type")} />
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Complete Address<span className="ml-0.5 text-red-500">*</span>
              </label>
              <AddressPicker onChange={(value) => setForm((f) => ({ ...f, address: value }))} invalid={isInvalid("address")} />
              {isInvalid("address") && <p className="mt-1 text-xs font-medium text-red-600">Complete the address above.</p>}
            </div>
            <Field label="School Website" name="website" value={form.website} onChange={handleChange} type="url" placeholder="www.yourschool.edu.ph (optional)" />
          </div>

          {/* Contact person */}
          <div className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-900">Dean / Principal (account owner)</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Full Name" name="contact_person" value={form.contact_person} onChange={handleChange} placeholder="Juan Dela Cruz" required invalid={isInvalid("contact_person")} />
              <Select label="Position" name="position" value={form.position} onChange={handleChange} options={POSITIONS} required invalid={isInvalid("position")} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Email Address" name="email" value={form.email} onChange={handleChange} type="email" placeholder="your@email.edu.ph" required invalid={isInvalid("email")} />
              <Field
                label="Contact Number"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                type="tel"
                placeholder="09XX-XXX-XXXX"
                required
                invalid={isInvalid("phone") || (submitAttempted && form.phone.length > 0 && form.phone.length !== 11)}
                invalidMessage={form.phone && form.phone.length !== 11 ? "Must be exactly 11 digits." : undefined}
              />
            </div>
          </div>

          {/* Account credentials */}
          <div className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <div>
              <h3 className="font-semibold text-slate-900">Create Your Account</h3>
              <p className="text-xs text-slate-500 mt-1">
                This email and password will be used to log in — even before your school is approved.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Password" name="password" value={form.password} onChange={handleChange} type="password" placeholder="At least 8 characters" required invalid={isInvalid("password")} />
              <Field label="Confirm Password" name="password_confirmation" value={form.password_confirmation} onChange={handleChange} type="password" placeholder="Re-enter password" required invalid={isInvalid("password_confirmation")} />
            </div>
          </div>

          {/* Program details */}
          <div className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-900">Program Details</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Select label="Expected Number of Interns (per semester)" name="intern_range" value={form.intern_range} onChange={handleChange} options={INTERN_RANGES} required invalid={isInvalid("intern_range")} />
            </div>
            <Select label="Which plan are you interested in?" name="interested_plan" value={form.interested_plan} onChange={handleChange} options={PLANS} required invalid={isInvalid("interested_plan")} />
            <Select label="How did you hear about Internova?" name="heard_from" value={form.heard_from} onChange={handleChange} options={HEARD_FROM} />
          </div>

          {/* Message */}
          <div className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-900">Your Message</h3>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Questions or additional information<span className="text-red-500 ml-0.5">*</span>
              </label>
              <textarea
                name="message"
                value={form.message}
                onChange={handleChange}
                required
                rows={5}
                maxLength={2000}
                placeholder="Tell us about your school's internship program, any specific questions, or request for a demo and quotation…"
                className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-1 resize-none ${isInvalid("message") ? errorBorder : normalBorder}`}
              />
              {isInvalid("message") && <p className="mt-1 text-xs font-medium text-red-600">This field is required.</p>}
            </div>
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-2xl bg-blue-600 py-3.5 text-base font-bold text-white hover:bg-blue-700 disabled:opacity-60 shadow-md"
          >
            {saving ? "Submitting…" : "Submit Registration Request →"}
          </button>

          <p className="text-center text-xs text-slate-400">
            By submitting this form, you agree to be contacted by the Internova team regarding your registration.
          </p>
        </form>
      </div>
    </div>
  );
}
