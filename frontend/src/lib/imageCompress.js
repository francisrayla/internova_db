"use client";

// Phone cameras produce 4–12 MB photos; shrinking them in the browser before
// upload keeps uploads fast on weak signal and storage small, and means people
// almost never hit a size limit. Only JPEG/PNG/WEBP photos that are large in
// bytes or pixels are touched — GIFs (animation), PDFs and documents pass
// through unchanged, and if anything fails the original file is returned.
const RESIZABLE = ["image/jpeg", "image/png", "image/webp"];

export async function shrinkImage(file, { maxSide = 1600, quality = 0.82, minBytes = 900 * 1024 } = {}) {
  if (!file || !RESIZABLE.includes(file.type) || typeof document === "undefined") return file;
  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    if (scale === 1 && file.size <= minBytes) {
      bitmap.close?.();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    // PNG screenshots may be transparent; JPEG has no alpha, so paint white first.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

async function loadBitmap(file) {
  if ("createImageBitmap" in window) {
    // Respects the photo's EXIF orientation, so portrait phone shots stay upright.
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
