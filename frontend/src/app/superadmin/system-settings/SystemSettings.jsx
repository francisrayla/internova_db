"use client";

import { useEffect, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { apiFetch } from "@/lib/apiFetch";

export default function SystemSettingsPage() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [toast, setToast] = useState("");
  const [drafts, setDrafts] = useState({});

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  useEffect(() => {
    fetchSuperadminData("system-settings")
      .then((r) => {
        const list = r.settings ?? [];
        setSettings(list);
        setDrafts(Object.fromEntries(list.filter((s) => s.type === "text").map((s) => [s.key, s.value ?? ""])));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function saveSetting(key, value) {
    setSavingKey(key);
    try {
      const res = await apiFetch(`/api/superadmin/system-settings/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save this setting.");
      setSettings((prev) => prev.map((s) => (s.key === key ? data.setting : s)));
      showToast(data.message);
    } catch (err) {
      showToast(err.message);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {toast && <div className="fixed bottom-6 right-6 z-50 rounded-2xl bg-slate-900 px-5 py-3 text-sm text-white shadow-lg">{toast}</div>}

      <div>
        <h2 className="text-lg font-semibold text-slate-900">System Settings</h2>
        <p className="mt-1 text-sm text-slate-600">Each setting saves immediately — there&apos;s nothing to lose by leaving this page.</p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-600">Loading settings…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {settings.map((setting) => (
            <div key={setting.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="font-semibold text-slate-900">{setting.name}</p>
              <p className="mt-1 text-sm text-slate-600">{setting.description}</p>
              {setting.key === "maintenance_mode" && (
                <p className="mt-2 text-xs font-medium text-amber-600">
                  Recorded here, but not yet enforced platform-wide — turning this on won&apos;t block access yet.
                </p>
              )}

              <div className="mt-4">
                {setting.type === "toggle" ? (
                  <button
                    onClick={() => saveSetting(setting.key, !setting.value)}
                    disabled={savingKey === setting.key}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                      setting.value
                        ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {savingKey === setting.key ? "Saving…" : setting.value ? "Enabled" : "Disabled"}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={drafts[setting.key] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [setting.key]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={() => saveSetting(setting.key, drafts[setting.key])}
                      disabled={savingKey === setting.key || drafts[setting.key] === setting.value}
                      className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      {savingKey === setting.key ? "Saving…" : "Save"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
