"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import AvatarUploadModal from "@/components/AvatarUploadModal";
import EditProfileModal from "@/components/EditProfileModal";
import { useCurrentUser } from "@/lib/UserContext";

export default function MyProfile() {
  const { user, onUserUpdated } = useCurrentUser();
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const initials = (user?.name || "S")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-600 text-lg font-semibold text-white">
          {user?.avatar_url ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" /> : initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold text-slate-900">{user?.name ?? "Supervisor"}</p>
          <p className="truncate text-sm text-slate-500">{user?.email ?? "—"}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto sm:shrink-0 sm:flex-col">
          <button
            type="button"
            onClick={() => setShowAvatarModal(true)}
            className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-300 px-3 py-2 sm:flex-none sm:justify-start sm:px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Icon name="camera" size={15} /> Change photo
          </button>
          <button
            type="button"
            onClick={() => setShowEditModal(true)}
            className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-300 px-3 py-2 sm:flex-none sm:justify-start sm:px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Icon name="edit" size={15} /> Edit profile
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-slate-100 pt-4 text-sm">
        {user?.phone && (
          <div className="flex justify-between border-b border-slate-100 py-2.5">
            <span className="text-slate-500">Phone</span>
            <span className="font-semibold text-slate-900">{user.phone}</span>
          </div>
        )}
        <div className="flex justify-between border-b border-slate-100 py-2.5">
          <span className="text-slate-500">School</span>
          <span className="font-semibold text-slate-900">{user?.school_name ?? "—"}</span>
        </div>
        <div className="flex justify-between py-2.5">
          <span className="text-slate-500">Status</span>
          <span className="font-semibold capitalize text-slate-900">{user?.status ?? "active"}</span>
        </div>
      </div>

      {showAvatarModal && (
        <AvatarUploadModal user={user} onClose={() => setShowAvatarModal(false)} onUpdated={onUserUpdated} />
      )}
      {showEditModal && (
        <EditProfileModal user={user} onClose={() => setShowEditModal(false)} onUpdated={onUserUpdated} />
      )}
    </div>
  );
}
