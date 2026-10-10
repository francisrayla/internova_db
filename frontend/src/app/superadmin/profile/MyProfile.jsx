"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import AvatarUploadModal from "@/components/AvatarUploadModal";
import { useCurrentUser } from "@/lib/UserContext";
import { Avatar, Btn, KeyValueList, Page, PageHeader, Section } from "@/components/dash/page";

export default function MyProfile() {
  const { user, onUserUpdated } = useCurrentUser();
  const [showAvatarModal, setShowAvatarModal] = useState(false);

  return (
    <Page size="narrow">
      <PageHeader title="My Profile" sentence="Your account details." />

      <Section>
        <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
          <Avatar name={user?.name || "Super Admin"} url={user?.avatar_url} size={64} tone="self" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold" style={{ color: "var(--ui-ink)" }}>{user?.name ?? "Super Admin"}</p>
            <p className="truncate text-sm" style={{ color: "var(--ui-muted)" }}>{user?.email ?? "—"}</p>
          </div>
          <Btn className="w-full sm:w-auto" onClick={() => setShowAvatarModal(true)}>
            <Icon name="camera" size={15} /> Change photo
          </Btn>
        </div>

        <div className="mt-5 pt-2" style={{ borderTop: "1px solid var(--ui-line)" }}>
          <KeyValueList
            items={[
              { label: "Role", value: <span className="capitalize">{(user?.role ?? "super_admin").replace("_", " ")}</span> },
              { label: "Status", value: <span className="capitalize">{user?.status ?? "active"}</span> },
            ]}
          />
        </div>
      </Section>

      {showAvatarModal && (
        <AvatarUploadModal user={user} onClose={() => setShowAvatarModal(false)} onUpdated={onUserUpdated} />
      )}
    </Page>
  );
}
