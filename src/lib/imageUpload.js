/**
 * Browser-side image preparation: resize the longest edge to <= 2000px and
 * re-encode as WebP (~0.85). Returns null for non-image files (e.g. PDF).
 */
const MAX_EDGE = 2000;

export async function prepareImage(file) {
  if (!file.type.startsWith("image/")) return null;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (!blob) return { file, width, height };

  const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
  return { file: new File([blob], name, { type: "image/webp" }), width, height };
}

/**
 * Upload files to the media library. `onProgress(done, total)` is optional.
 */
export async function uploadMedia(files, prefix, onProgress) {
  const prepared = [];
  const meta = [];
  for (const file of files) {
    const result = await prepareImage(file);
    if (result) {
      prepared.push(result.file);
      meta.push({ width: result.width, height: result.height });
    } else {
      prepared.push(file);
      meta.push({});
    }
  }

  const form = new FormData();
  prepared.forEach((f) => form.append("file", f));
  form.append("prefix", prefix);
  form.append("meta", JSON.stringify(meta));

  if (onProgress) onProgress(prepared.length, prepared.length);
  return prepared.length ? (await import("./api")).api("/admin/media", { method: "POST", body: form }) : null;
}
