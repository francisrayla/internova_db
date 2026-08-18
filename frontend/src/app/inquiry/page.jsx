"use client";

import { useState } from "react";
import Link from "next/link";

const SCHOOL_TYPES = ["Public Elementary/High School", "Private High School", "Technical/Vocational", "State University/College", "Private College/University", "Other"];
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

function Field({ label, name, value, onChange, type = "text", placeholder, required }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
      />
    </div>
  );
}

function Select({ label, name, value, onChange, options, required }) {
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
        className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 appearance-none"
      >
        <option value="">Select an option…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export default function InquiryPage() {
  const [form, setForm] = useState(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  function handleSubmit(e) {
    e.preventDefault();
    setError("");

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
      .then(() => setSubmitted(true))
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
            You can log in anytime using <strong>{form.email}</strong> and the password you just created to check your approval status.
          </p>
          <div className="mt-6 rounded-2xl bg-blue-50 p-4 text-sm text-blue-800 text-left space-y-1">
            <p className="font-semibold">What happens next?</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-700 mt-1">
              <li>Our team reviews your registration (usually within 1–2 business days)</li>
              <li>We may reach out to discuss your needs and plan</li>
              <li>Once approved, your school account is created</li>
              <li>Log in with the same email and password to complete payment</li>
              <li>Your dashboard opens as soon as payment is confirmed</li>
            </ol>
          </div>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link
              href="/login"
              className="inline-block rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Log In Now
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
            🎓 Internova AI — Internship Management Platform
          </div>
          <h1 className="text-3xl font-bold text-slate-900">School Registration</h1>
          <p className="mt-2 text-slate-600 max-w-lg mx-auto">
            Register your school and tell us about your internship program. You'll be able to log in right away to
            check your status — full access opens once our team approves your school and payment is confirmed.
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

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* School info */}
          <div className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-900">School Information</h3>
            <Field label="School Name" name="school_name" value={form.school_name} onChange={handleChange} placeholder="e.g. PMFTCI" required />
            <Select label="School Type" name="school_type" value={form.school_type} onChange={handleChange} options={SCHOOL_TYPES} required />
            <Field label="Complete Address" name="address" value={form.address} onChange={handleChange} placeholder="City, Province" required />
            <Field label="School Website" name="website" value={form.website} onChange={handleChange} placeholder="www.yourschool.edu.ph (optional)" />
          </div>

          {/* Contact person */}
          <div className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-900">Contact Person</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Full Name" name="contact_person" value={form.contact_person} onChange={handleChange} placeholder="Juan Dela Cruz" required />
              <Field label="Position / Title" name="position" value={form.position} onChange={handleChange} placeholder="OJT Coordinator" required />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Email Address" name="email" value={form.email} onChange={handleChange} type="email" placeholder="your@email.edu.ph" required />
              <Field label="Contact Number" name="phone" value={form.phone} onChange={handleChange} placeholder="09XX-XXX-XXXX" required />
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
              <Field label="Password" name="password" value={form.password} onChange={handleChange} type="password" placeholder="At least 8 characters" required />
              <Field label="Confirm Password" name="password_confirmation" value={form.password_confirmation} onChange={handleChange} type="password" placeholder="Re-enter password" required />
            </div>
          </div>

          {/* Program details */}
          <div className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-slate-900">Program Details</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Select label="Expected Number of Interns (per semester)" name="intern_range" value={form.intern_range} onChange={handleChange} options={INTERN_RANGES} required />
              <Field label="Number of OJT Coordinators" name="expected_coordinators" value={form.expected_coordinators} onChange={handleChange} placeholder="e.g. 3" />
            </div>
            <Select label="Which plan are you interested in?" name="interested_plan" value={form.interested_plan} onChange={handleChange} options={PLANS} required />
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
                placeholder="Tell us about your school's internship program, any specific questions, or request for a demo and quotation…"
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 resize-none"
              />
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
