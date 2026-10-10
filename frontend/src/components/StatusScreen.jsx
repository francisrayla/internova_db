import Logo from "@/components/Logo";

const TONES = {
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
};

/**
 * A calm full-page message with the brand, an icon, a short title and sentence, and the actions
 * (children) underneath. Used by the error page, the not-found page and /school-access.
 * Server-safe: it has no state, so a server component (not-found) can render it too.
 */
export default function StatusScreen({ icon: Icon, tone = "blue", eyebrow, title, text, detail, children }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4 sm:p-6">
      <div className="dash-card mx-auto flex w-full max-w-md flex-col items-center gap-5 p-6 text-center sm:p-10">
        <Logo size={34} />
        {Icon ? (
          <div className={`grid h-14 w-14 place-items-center rounded-2xl ${TONES[tone] || TONES.blue}`}>
            <Icon size={28} aria-hidden="true" />
          </div>
        ) : null}
        <div>
          {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-700">{eyebrow}</p> : null}
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">{title}</h1>
          {text ? <p className="mt-2 text-sm text-slate-600">{text}</p> : null}
          {detail ? <p className="mt-3 text-xs text-slate-500">{detail}</p> : null}
        </div>
        {children ? <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">{children}</div> : null}
      </div>
    </main>
  );
}
