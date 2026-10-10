import Link from "next/link";
import NavIcon from "@/components/NavIcon";

/** Frame of one settings screen: a way back to the role's Settings page, then the screen itself. */
export default function SettingsScreen({ role, children }) {
  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/${role}/settings`} className="k-back mb-2">
        <NavIcon name="back" size={16} />
        Settings
      </Link>
      {children}
    </div>
  );
}
