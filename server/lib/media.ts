/** Shapes returned to clients for images/media. */

export type ImageRef = {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
};

export type MediaRow = {
  id: string;
  key: string;
  filename: string | null;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  created_at: string;
};

export function mediaUrl(key: string): string {
  return `/media/${key}`;
}

export function imageShape(
  row: { key: string; alt: string | null; width: number | null; height: number | null } | null,
): ImageRef | null {
  if (!row) return null;
  return { url: mediaUrl(row.key), alt: row.alt, width: row.width, height: row.height };
}

export function mediaShape(row: MediaRow) {
  return {
    id: row.id,
    key: row.key,
    url: mediaUrl(row.key),
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    alt: row.alt,
    createdAt: row.created_at,
  };
}
