"use client";

import { useState } from "react";
import { Camera, Pencil } from "lucide-react";
import AvatarUploadModal from "@/components/AvatarUploadModal";
import EditProfileModal from "@/components/EditProfileModal";
import { Avatar, Btn, KeyValueList, Page, PageHeader, Section } from "@/components/dash/page";
import { useCurrentUser } from "@/lib/UserContext";
import { headTitle } from "@/lib/headTitle";

/**
 * Profile page shared by the coordinator, supervisor and Dean "My Profile" pages:
 * photo, name, email, and the account details below. `roleLabel` adds a
 * Role row (coordinators show whether they're the school's primary one);
 * `headRole` shows the school head's own title (Dean / Principal / School Head).
 */
export default function StaffProfile({ fallbackName, roleLabel, headRole = false }) {
  const { user, onUserUpdated } = useCurrentUser();
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const details = [
    ...(user?.phone ? [{ label: "Phone", value: user.phone }] : []),
    { label: "School", value: user?.school_name ?? "—" },
    ...(headRole ? [{ label: "Role", value: headTitle(user) }] : roleLabel ? [{ label: "Role", value: roleLabel }] : []),
    { label: "Status", value: <span className="capitalize">{user?.status ?? "active"}</span> },
  ];

  return (
    <Page size="narrow">
      <PageHeader title="My profile" sentence="Your details as the school and your interns see them." />

      <Section>
        <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap sm:gap-5">
          <Avatar name={user?.name ?? fallbackName} url={user?.avatar_url} size={72} tone="self" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-900">{user?.name ?? fallbackName}</h2>
            <p className="truncate text-sm text-slate-600">{user?.email ?? "—"}</p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
            <Btn onClick={() => setShowAvatarModal(true)} className="max-sm:flex-1">
              <Camera size={15} aria-hidden="true" /> Change photo
            </Btn>
            <Btn onClick={() => setShowEditModal(true)} className="max-sm:flex-1">
              <Pencil size={15} aria-hidden="true" /> Edit profile
            </Btn>
          </div>
        </div>
        <div className="mt-5 border-t border-slate-200 pt-4">
          <KeyValueList items={details} />
        </div>
      </Section>

      {showAvatarModal && (
        <AvatarUploadModal user={user} onClose={() => setShowAvatarModal(false)} onUpdated={onUserUpdated} />
      )}
      {showEditModal && (
        <EditProfileModal user={user} onClose={() => setShowEditModal(false)} onUpdated={onUserUpdated} />
      )}
    </Page>
  );
}
