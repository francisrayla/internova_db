"use client";

import NavIcon from "@/components/NavIcon";
import { EmptyState } from "@/components/ui";
import { Section } from "@/components/dash/page";

/** Read-only rendering of an intern's portfolio, shared by the supervisor
 * and coordinator "view intern" screens — same shape as what the intern
 * sees while editing (MyPortfolio.jsx), just without the edit controls. */
export default function InternPortfolioView({ internName, portfolio }) {
  if (!portfolio) {
    return (
      <EmptyState
        icon="portfolio"
        title={`${internName ? `${internName} hasn't` : "This intern hasn't"} set up a portfolio yet.`}
        text="Nothing to show here until they add a bio or their first work sample."
      />
    );
  }

  return (
    <div className="space-y-5">
      <Section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Portfolio</p>
        <h2 className="mt-1 break-words text-xl font-semibold text-slate-900">{portfolio.title || `${internName ?? "Intern"}'s Portfolio`}</h2>
        <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-600">{portfolio.bio || "No bio written yet."}</p>
      </Section>

      <Section title="Work samples">
        {(portfolio.items?.length ?? 0) === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No work samples added yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {portfolio.items.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-2xl border border-slate-200">
                {item.image_url && <img src={item.image_url} alt="" className="h-36 w-full object-cover" />}
                <div className="p-4">
                  <p className="break-words text-sm font-semibold text-slate-900">{item.title}</p>
                  {item.description && <p className="mt-1 break-words text-xs text-slate-600">{item.description}</p>}
                  {item.project_url && (
                    <a href={item.project_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline max-sm:min-h-[44px]">
                      View project <NavIcon name="arrow" size={13} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
