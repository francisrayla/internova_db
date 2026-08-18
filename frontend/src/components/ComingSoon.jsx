import Icon from "@/components/Icon";

/**
 * Honest placeholder for a nav-linked screen that isn't built yet — used
 * instead of fabricating data or copy that implies a working feature.
 */
export default function ComingSoon({ icon = "calendar", title, description }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
        <Icon name={icon} size={26} />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p>
      <span className="mt-4 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Not built yet</span>
    </div>
  );
}
