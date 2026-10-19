import Link from "next/link";
import { FileText, ShieldCheck } from "lucide-react";
import Logo from "@/components/Logo";
import LegalBackButton from "@/components/LegalBackButton";
import { Page, PageHeader, Section } from "@/components/dash/page";
import { TERMS_VERSION, TERMS_UPDATED_LABEL } from "@/lib/legal";

/**
 * Shared frame of the public /terms and /privacy pages: logo bar, title, the
 * "Last updated / version" line, a jump list and one card per topic. No login
 * needed. `sections` = [{ id, title, content }].
 */
export default function LegalPage({ kind, title, sentence, sections }) {
  const other = kind === "terms" ? { href: "/privacy", label: "Privacy Notice", Icon: ShieldCheck } : { href: "/terms", label: "Terms and Conditions", Icon: FileText };
  return (
    <main className="min-h-screen bg-slate-50 pb-16">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[760px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Internova home"><Logo size={28} /></Link>
          <LegalBackButton />
        </div>
      </div>

      <div className="px-4 pt-6 sm:px-6">
        <Page size="narrow">
          <PageHeader
            title={title}
            sentence={sentence}
            meta={`Last updated ${TERMS_UPDATED_LABEL} · Version ${TERMS_VERSION}`}
          />

          <nav aria-label="On this page" className="dash-card" style={{ padding: "14px 16px" }}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">On this page</p>
            <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="inline-flex min-h-8 items-center text-blue-700 hover:underline">
                    {i + 1}. {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {sections.map((s, i) => (
            <div key={s.id} id={s.id} className="scroll-mt-4">
              <Section title={`${i + 1}. ${s.title}`}>
                <div className="legal-body space-y-3 text-sm leading-relaxed text-slate-700">{s.content}</div>
              </Section>
            </div>
          ))}

          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            <other.Icon className="h-4 w-4" aria-hidden="true" />
            Also read the{" "}
            <Link href={other.href} className="font-semibold text-blue-700 hover:underline">{other.label}</Link>.
          </p>
        </Page>
      </div>
    </main>
  );
}

/** Bulleted list used inside the legal sections. */
export function Bullets({ items }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-slate-400">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}
