"use client";

/** Read-only rendering of an intern's portfolio, shared by the supervisor
 * and coordinator "view intern" screens — same shape as what the intern
 * sees while editing (MyPortfolio.jsx), just without the edit controls. */
export default function InternPortfolioView({ internName, portfolio }) {
  if (!portfolio) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center">
        <p className="text-sm font-medium text-slate-600">{internName ? `${internName} hasn't` : "This intern hasn't"} set up a portfolio yet.</p>
        <p className="mt-1 text-sm text-slate-400">Nothing to show here until they add a bio or their first work sample.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">Portfolio</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{portfolio.title || `${internName ?? "Intern"}'s Portfolio`}</h1>
        <p className="mt-1 text-sm text-slate-600">{portfolio.bio || "No bio written yet."}</p>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Work samples</h2>
        {(portfolio.items?.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No work samples added yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {portfolio.items.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-2xl border border-slate-200">
                {item.image_url && <img src={item.image_url} alt="" className="h-36 w-full object-cover" />}
                <div className="p-4">
                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                  {item.description && <p className="mt-1 text-xs text-slate-600">{item.description}</p>}
                  {item.project_url && (
                    <a href={item.project_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-blue-600 hover:underline">
                      View project ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
