export async function compressImage(file: File, maxDim = 1600, maxBytes = 500 * 1024): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG, or WebP photo.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose a photo smaller than 20 MB.");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
  if (bitmap.width * bitmap.height > 40000000) throw new Error("Choose a photo smaller than 40 megapixels.");
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not prepare this photo.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);

  // binary search quality to meet size
  let quality = 0.9;
  let blob: Blob | null = null;
  for (let i = 0; i < 6; i++) {
    blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) break;
    if (blob.size <= maxBytes || quality <= 0.3) break;
    quality -= 0.12;
  }
  if (!blob) throw new Error("This photo could not be prepared. Try another image.");
  // if still too large, shrink dimensions further
  let smallerScale = 0.85;
  for (let i = 0; blob.size > maxBytes && i < 6; i++) {
    canvas.width = Math.round(w * smallerScale);
    canvas.height = Math.round(h * smallerScale);
    const ctx2 = canvas.getContext("2d");
    if (!ctx2) throw new Error("This photo could not be prepared.");
    ctx2.fillStyle = "#ffffff";
    ctx2.fillRect(0, 0, canvas.width, canvas.height);
    ctx2.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const b2 = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.7));
    if (b2) blob = b2;
    smallerScale *= 0.8;
  }
  if (blob.size > maxBytes) throw new Error("This photo is too large. Try a smaller image.");
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
  } finally { bitmap.close(); }
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
