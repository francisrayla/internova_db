"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";

// Where apiFetch sends anyone who hits a 503 from EnforceMaintenanceMode
// (see backend/app/Http/Middleware/EnforceMaintenanceMode.php), and where a
// blocked login attempt's error message points too. Polls /api/health every
// 20s — that route is exempt from the maintenance block — and bounces back
// to login the moment it reports maintenance is off, so nobody has to
// remember to come back and refresh manually.
export default function Maintenance() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!data.maintenance) {
        router.replace("/login");
        return;
      }
    } catch {
      // Stay put — the backend itself may be the thing being worked on.
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    // Check once right away (someone may open this page when there is no maintenance), then every 20s.
    const first = setTimeout(checkNow, 0);
    const id = setInterval(checkNow, 20000);
    return () => { clearTimeout(first); clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-100 text-amber-700"><Wrench size={28} aria-hidden="true" /></div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-600">Under maintenance</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">We&apos;ll be right back</h1>
          <p className="mt-2 text-sm text-slate-600">
            Internova is undergoing scheduled maintenance. Your data is safe — this page will take you back automatically once we&apos;re done.
          </p>
        </div>
        <button
          type="button"
          onClick={checkNow}
          disabled={checking}
          className="mt-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
    </section>
  );
}
