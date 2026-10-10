"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Trash2 } from "lucide-react";
import { Avatar, Btn, SheetFrame } from "@/components/dash/page";
import { apiFetch } from "@/lib/apiFetch";
import { validateImageFile } from "@/lib/imageValidation";
import { shrinkImage } from "@/lib/imageCompress";

const MAX_BYTES = 10 * 1024 * 1024;

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

  async function handlePick(e) {
    const picked = await shrinkImage(e.target.files?.[0]);
    if (!picked) return;
    const validationError = validateImageFile(picked, MAX_BYTES);
    if (validationError) {
      setError(validationError);
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
    <SheetFrame
      title="Profile photo"
      description="This is shown across the app, including in messages."
      onClose={onClose}
      zIndex={120}
      footer={
        <>
          {user?.avatar_url && !file && (
            <Btn variant="danger-quiet" onClick={handleRemove} disabled={removing} className="sm:mr-auto">
              <Trash2 size={15} aria-hidden="true" /> {removing ? "Removing…" : "Remove photo"}
            </Btn>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSave} disabled={!file || saving}>
            {saving ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <div className="mt-2 flex flex-col items-center gap-4">
        <Avatar name={user?.name ?? "Intern"} url={previewUrl || user?.avatar_url} size={112} />
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handlePick} />
        <Btn onClick={() => inputRef.current?.click()} className="max-sm:w-full">
          <Camera size={15} aria-hidden="true" /> Choose photo
        </Btn>
      </div>
      {error && <p role="alert" className="k-note is-risk mt-4">{error}</p>}
    </SheetFrame>,
    document.body
  );
}
