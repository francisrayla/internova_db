"use client";

import Link from "next/link";
import Logo from "@/components/Logo";

const FEATURES = [
  {
    icon: "📍",
    title: "GPS + Selfie Attendance",
    description: "Interns clock in and out with a selfie stamped with GPS location, time, and distance from the partner company.",
  },
  {
    icon: "✅",
    title: "Task Management",
    description: "Supervisors assign tasks, track progress, and rate each completed task — not just a final grade.",
  },
  {
    icon: "📋",
    title: "Formal Evaluations",
    description: "Schools set their own grading criteria. Coordinators and supervisors submit monthly, midterm, and final evaluations.",
  },
  {
    icon: "🎓",
    title: "AI Portfolio & Reports",
    description: "Interns build a shareable portfolio automatically, generated from their tasks, hours, and evaluations.",
  },
  {
    icon: "💬",
    title: "Real-time Messaging",
    description: "Coordinators, supervisors, and interns stay connected without leaving the platform.",
  },
  {
    icon: "🏢",
    title: "Multi-Company Support",
    description: "Manage every partner company your school works with, each with its own supervisors and interns.",
  },
];

const STEPS = [
  { step: "1", title: "Tell us about your school", description: "Submit a quick inquiry with your school's internship program details." },
  { step: "2", title: "We set up your account", description: "Our team confirms your plan and creates your school's coordinator account." },
  { step: "3", title: "Invite your team", description: "Add supervisors and interns, and start tracking attendance and tasks on day one." },
];

const PLANS = [
  {
    name: "Basic",
    tagline: "For schools getting started with digital internship tracking.",
    features: [
      "GPS + Selfie Attendance",
      "Task Management (Pending / Ongoing / Done)",
      "Basic Monitoring & Reports",
    ],
  },
  {
    name: "Premium",
    tagline: "For schools that need full performance tracking and AI tools.",
    highlighted: true,
    features: [
      "Everything in Basic",
      "Subtasks, Attachments, Task Comments",
      "Real-time Chat",
      "Per-task Rating & Formal Evaluations",
      "AI Portfolio & Reports",
    ],
  },
];

function NavBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Logo size={34} />
        <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
          <a href="#features" className="hover:text-blue-700">Features</a>
          <a href="#how-it-works" className="hover:text-blue-700">How it Works</a>
          <a href="#pricing" className="hover:text-blue-700">Pricing</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
            Log In
          </Link>
          <Link href="/inquiry" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-slate-800">
      <NavBar />

      {/* Hero */}
      <section className="bg-gradient-to-br from-blue-50 to-white">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700">
            🎓 Internship Management Platform
          </div>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Run your school's OJT program without the paperwork
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
            Internova AI helps schools track intern attendance, tasks, and evaluations in one place —
            with GPS-verified selfie attendance and AI-generated portfolios.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/inquiry" className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
              Request More Information
            </Link>
            <Link href="/login" className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Log In to Your Account
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Features</p>
          <h2 className="mt-2 text-3xl font-bold text-slate-900">Everything your program needs</h2>
          <p className="mt-3 text-slate-600">From attendance to evaluations, all in one platform built for internship coordinators.</p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
              <div className="text-3xl">{f.icon}</div>
              <h3 className="mt-4 font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-slate-50 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">How It Works</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900">Get started in three steps</h2>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.step} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">
                  {s.step}
                </div>
                <h3 className="mt-4 font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section id="pricing" className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Pricing</p>
          <h2 className="mt-2 text-3xl font-bold text-slate-900">Simple plans for every school</h2>
          <p className="mt-3 text-slate-600">Talk to us to find the right plan and pricing for your internship program.</p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`rounded-3xl border p-8 ${
                p.highlighted ? "border-blue-400 bg-blue-50 shadow-md" : "border-slate-200 bg-white shadow-sm"
              }`}
            >
              {p.highlighted && (
                <span className="mb-3 inline-block rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
                  Most Popular
                </span>
              )}
              <h3 className="text-xl font-bold text-slate-900">{p.name}</h3>
              <p className="mt-2 text-sm text-slate-600">{p.tagline}</p>
              <ul className="mt-5 space-y-2 text-sm text-slate-700">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-blue-600">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/inquiry"
                className={`mt-6 inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold ${
                  p.highlighted ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                Request This Plan
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA banner */}
      <section className="bg-blue-600">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h2 className="text-3xl font-bold text-white">Ready to modernize your OJT program?</h2>
          <p className="mt-3 text-blue-50">Tell us about your school and our team will reach out within 1–2 business days.</p>
          <Link
            href="/inquiry"
            className="mt-6 inline-block rounded-xl bg-white px-6 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            Request More Information
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <Logo size={28} />
            <div className="flex flex-wrap gap-6 text-sm text-slate-600">
              <a href="mailto:hello@internova.ai" className="hover:text-blue-700">hello@internova.ai</a>
              <a href="tel:+639171234567" className="hover:text-blue-700">+63 917 123 4567</a>
              <span>Facebook: @internova.ai</span>
            </div>
          </div>
          <p className="mt-6 text-xs text-slate-400">© {new Date().getFullYear()} Internova AI. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
