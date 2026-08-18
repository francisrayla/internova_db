"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/Icon";
import { apiFetch } from "@/lib/apiFetch";

function initialsOf(name) {
  return (name || "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Same shared modal for every role — opened from each layout's profile menu
 * (or, for intern, straight from the header avatar since that layout has no
 * dropdown menu at all). Portalled to <body> for the same reason ChatWindow
 * is: a header with backdrop-blur establishes a new containing block for
 * position:fixed descendants, so a non-portalled modal renders clipped near
 * the header instead of centered on the viewport.
 */
export default function AvatarUploadModal({ user, onClose, onUpdated }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handlePick(e) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    if (!picked.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (picked.size > MAX_BYTES) {
      setError("Image must be 3MB or smaller.");
      return;
    }
    setError("");
    setFile(picked);
  }

  async function handleSave() {
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await apiFetch("/api/auth/avatar", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not upload photo.");
      onUpdated(data.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setError("");
    try {
      const res = await apiFetch("/api/auth/avatar", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Could not remove photo.");
      onUpdated(data.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setRemoving(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Profile photo</h3>
        <p className="mt-1 text-xs text-slate-500">This is shown across the app, including in messages.</p>

        <div className="mt-5 flex flex-col items-center gap-3">
          <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-full bg-blue-600 text-3xl font-semibold text-white ring-4 ring-slate-100">
            {previewUrl || user?.avatar_url ? (
              <img src={previewUrl || user.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initialsOf(user?.name)
            )}
          </div>

          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handlePick} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Icon name="camera" size={15} /> Choose photo
          </button>
        </div>

        {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-6 flex items-center justify-between gap-2">
          {user?.avatar_url && !file ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              <Icon name="trash" size={14} /> {removing ? "Removing…" : "Remove photo"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!file || saving}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
