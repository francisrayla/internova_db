"use client";

import { useEffect, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";
import { apiFetch } from "@/lib/apiFetch";
import { Check } from "lucide-react";
import { Btn, DataList, EmptyState, Input, Page, PageHeader, Section, SkeletonList } from "@/components/dash/page";
import SaToast, { useSaToast } from "../SaToast";

import { inputProps } from "@/lib/inputRules";
export default function SystemSettingsPage() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [toast, showToast] = useSaToast();
  const [drafts, setDrafts] = useState({});

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
    <Page size="narrow">
      <SaToast msg={toast} />

      <PageHeader
        back={{ href: "/superadmin/settings", label: "Settings" }}
        title="System Settings"
        sentence="Switches save at once; text fields need their Save button."
      />

      {loading ? (
        <Section><SkeletonList rows={3} height="h-16" /></Section>
      ) : settings.length === 0 ? (
        <Section>
          <EmptyState icon="settings" title="No settings found" text="System settings are created on the server. Reload the page, or check that the backend is running." />
        </Section>
      ) : (
        <Section flush>
          <DataList>
            {settings.map((setting) => (
              <li key={setting.key} className="k-item grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
                <div className="min-w-0">
                  <p className="text-[0.9375rem] font-medium" style={{ color: "var(--ui-ink)" }}>{setting.name}</p>
                  <p className="mt-0.5 text-sm" style={{ color: "var(--ui-muted)" }}>{setting.description}</p>
                  {setting.key === "maintenance_mode" && setting.value && (
                    <p className="k-note is-warn mt-2">
                      <span className="min-w-0">Live now — every school and role except Super Admin sees a maintenance page until this is turned off.</span>
                    </p>
                  )}
                </div>

                {setting.type === "toggle" ? (
                  <Btn
                    variant={setting.value ? "primary" : "secondary"}
                    aria-pressed={Boolean(setting.value)}
                    onClick={() => saveSetting(setting.key, !setting.value)}
                    disabled={savingKey === setting.key}
                    className="sm:min-w-[7.5rem]"
                  >
                    {savingKey === setting.key ? "Saving…" : setting.value ? (<><Check size={15} aria-hidden="true" /> Enabled</>) : "Disabled"}
                  </Btn>
                ) : (
                  <div className="flex gap-2 sm:w-80">
                    <Input {...inputProps("settingValue")}
                      type="text"
                      aria-label={setting.name}
                      value={drafts[setting.key] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [setting.key]: e.target.value }))}
                      className="min-w-0 flex-1"
                    />
                    <Btn
                      onClick={() => saveSetting(setting.key, drafts[setting.key])}
                      disabled={savingKey === setting.key || drafts[setting.key] === setting.value}
                      className="shrink-0"
                    >
                      {savingKey === setting.key ? "Saving…" : "Save"}
                    </Btn>
                  </div>
                )}
              </li>
            ))}
          </DataList>
        </Section>
      )}
    </Page>
  );
}
