import Link from "next/link";
import Icon from "@/components/Icon";

/**
 * The single "Settings" page of a role: a short list of cards, each opening its
 * own screen. Role pages pass their own groups (see RoleSettingsHub).
 */
export default function SettingsHub({ title = "Settings", intro, groups }) {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        {intro && <p className="mt-1 text-sm text-slate-600">{intro}</p>}
      </div>

      {groups.map((group) => (
        <section key={group.heading} aria-label={group.heading}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.heading}</h3>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {group.items.map((item) => (
              <li key={item.href} className="min-w-0">
                <Link
                  href={item.href}
                  className="group flex h-full items-start gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
                    <Icon name={item.icon} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                    <span className="mt-0.5 block text-sm text-slate-600">{item.description}</span>
                  </span>
                  <span className="mt-1 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600">
                    <Icon name="arrow" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
