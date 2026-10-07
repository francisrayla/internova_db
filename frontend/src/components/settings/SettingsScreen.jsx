import Link from "next/link";

/** Frame of one settings screen: a way back to the role's Settings page, then the screen itself. */
export default function SettingsScreen({ role, children }) {
  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/${role}/settings`} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline">
        <span aria-hidden="true">←</span> Settings
      </Link>
      {children}
    </div>
  );
}
