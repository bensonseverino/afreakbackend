import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Select,
  Spinner,
  StatusDot,
  TextArea,
  TextInput,
  useToast,
} from "../components/ui";
import MediaPicker from "./MediaPicker";
import { SETTINGS_KEYS } from "../../shared/settingsKeys.js";
import { SITE_URL, ctaUrlError, liveCheck, moveItem } from "./contentTools";

/** LIVE / HIDDEN badge for a content row. */
function VisibilityBadge({ active }) {
  return (
    <span className="label inline-flex items-center gap-2 border border-line px-2 py-1">
      <StatusDot tone={active ? "ok" : "graphite"} />
      {active ? "LIVE" : "HIDDEN"}
    </span>
  );
}

/* ---------------------------------------------- generic settings editor */
function SettingsCard({ settingKey, title, render, liveCheckPath, liveCheckPredicate }) {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ["setting", settingKey],
    queryFn: () => api(`/admin/settings/${settingKey}`).then((r) => r.data),
  });
  // Draft overrides what the server returned until the next save; no effect needed.
  const [draft, setValue] = useState(null);
  const value = draft ?? query.data ?? null;

  const save = useMutation({
    mutationFn: (v) => api(`/admin/settings/${settingKey}`, { method: "PUT", body: { value: v } }),
    onSuccess: async () => {
      toast.push("Saved");
      qc.invalidateQueries({ queryKey: ["setting", settingKey] });
      if (liveCheckPath && liveCheckPredicate) {
        const check = await liveCheck(liveCheckPath, liveCheckPredicate);
        toast.push(
          check.ok ? "LIVE ON SITE ✓" : `SAVED — NOT VISIBLE ON SITE (${check.reason})`,
          check.ok ? "ink" : "danger",
        );
      }
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="label text-graphite">{title}</p>
        <Button size="sm" variant="outline" onClick={() => save.mutate(value)} disabled={value === null}>
          Save
        </Button>
      </div>
      {query.isLoading || value === null ? <Spinner label="Loading" /> : render(value, setValue)}
    </Card>
  );
}

/* ------------------------------------------------ menu feature tile fields */
function MenuFeatureFields({ value, setValue }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const image = value.image ?? null;
  const preview = image?.url ?? (image?.key ? `/media/${image.key}` : null);

  return (
    <div className="space-y-3">
      <Field label="Eyebrow">
        <TextInput
          value={value.eyebrow ?? ""}
          onChange={(e) => setValue({ ...value, eyebrow: e.target.value })}
        />
      </Field>
      <Field label="Title">
        <TextInput
          value={value.title ?? ""}
          onChange={(e) => setValue({ ...value, title: e.target.value })}
        />
      </Field>
      <Field label="URL" error={ctaUrlError(value.url)}>
        <TextInput
          value={value.url ?? ""}
          onChange={(e) => setValue({ ...value, url: e.target.value })}
        />
      </Field>
      <Field label="Tile image">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden border border-line bg-mist">
            {preview ? (
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="label text-center text-[9px] text-stone">NO IMAGE</span>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            {image ? "Change image" : "Choose image"}
          </Button>
          {image && (
            <Button size="sm" variant="ghost" onClick={() => setValue({ ...value, image: null })}>
              Remove
            </Button>
          )}
        </div>
      </Field>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Menu feature image"
        selectedIds={[]}
        onSelect={(ids, items = []) => {
          const media = items.find((item) => item.id === ids[0]) ?? items[0] ?? null;
          setValue({
            ...value,
            image: media
              ? {
                  key: media.key,
                  url: media.url,
                  alt: media.alt ?? null,
                  width: media.width ?? null,
                  height: media.height ?? null,
                }
              : null,
          });
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ hero slides *//** Live preview of one slide in the hero's layout (§7.1). */
function HeroPreview({ form }) {
  const image = form.image?.url ?? null;
  return (
    <div className="border border-line">
      <div className="grid grid-cols-2 gap-3 p-3">
        <div className="space-y-2">
          <p className="label text-[10px] text-stone">{form.eyebrow || "EYEBROW"}</p>
          <p className="font-display text-[18px] font-black uppercase leading-[0.95]">
            {(form.title || "SLIDE TITLE").split(/\s+/).slice(0, 6).join(" ")}
          </p>
          <p className="text-[12px] text-graphite">{form.subtitle || "Subtitle text"}</p>
          <span className="label inline-block border border-ink px-2 py-1 text-[11px]">
            {form.ctaLabel || "SHOP NOW"}
          </span>
        </div>
        <div className="aspect-[3/4] bg-mist overflow-hidden">
          {image ? (
            <img src={image} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="label flex h-full items-center justify-center text-stone">NO IMAGE</div>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroEditor() {
  const qc = useQueryClient();
  const toast = useToast();
  const content = useQuery({
    queryKey: ["admin-content"],
    queryFn: () => api("/admin/content").then((r) => r.data),
  });
  const [slide, setSlide] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-content"] });

  const save = useMutation({
    mutationFn: ({ id, body }) =>
      id
        ? api(`/admin/content/hero/${id}`, { method: "PUT", body })
        : api("/admin/content/hero", { method: "POST", body }),
    onSuccess: async (res, variables) => {
      const id = variables.id ?? res?.data?.id ?? null;
      invalidate();
      setSlide(null);
      if (variables.body.active === false) {
        toast.push("Saved · HIDDEN (not shown on the site)");
        return;
      }
      const check = await liveCheck("/home", (data) =>
        (data?.heroSlides ?? []).some((s) =>
          id ? s.id === id : s.title === variables.body.title,
        ),
      );
      toast.push(
        check.ok ? "LIVE ON SITE ✓" : `SAVED — NOT VISIBLE ON SITE (${check.reason})`,
        check.ok ? "ink" : "danger",
      );
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ row }) =>
      api(`/admin/content/hero/${row.id}`, {
        method: "PUT",
        body: {
          eyebrow: row.eyebrow,
          title: row.title,
          subtitle: row.subtitle,
          ctaLabel: row.ctaLabel,
          ctaUrl: row.ctaUrl,
          mediaId: row.mediaId,
          sort: row.sort,
          active: !row.active,
        },
      }),
    onSuccess: () => {
      toast.push("Visibility updated");
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const reorder = useMutation({
    mutationFn: (ids) =>
      api("/admin/content/hero-slides/reorder", { method: "PUT", body: { ids } }),
    onSuccess: () => {
      toast.push("Order saved");
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/content/hero/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.push("Slide deleted");
      invalidate();
    },
  });

  if (content.isLoading) return <Spinner />;
  const slides = content.data?.heroSlides ?? [];
  const ids = slides.map((s) => s.id);

  const move = (index, delta) => {
    const to = index + delta;
    if (to < 0 || to >= slides.length) return;
    reorder.mutate(moveItem(ids, index, to));
  };

  const onDrop = (index) => {
    if (dragIndex === null || dragIndex === index) return;
    reorder.mutate(moveItem(ids, dragIndex, index));
    setDragIndex(null);
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label text-graphite">
            Hero slides ({slides.length}/5) — first slide shows first
          </p>
          <p className="mt-1 text-[12px] text-stone">
            The homepage shows every LIVE slide. Reorder with the arrows (or drag).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            className="label text-stone underline hover:text-ink"
            href={`${SITE_URL}/?debug=1`}
            target="_blank"
            rel="noopener noreferrer"
          >
            VIEW ON SITE ↗
          </a>
          <Button
            size="sm"
            disabled={slides.length >= 5}
            onClick={() =>
              setSlide({
                id: null,
                form: {
                  eyebrow: "",
                  title: "",
                  subtitle: "",
                  ctaLabel: "",
                  ctaUrl: "",
                  mediaId: null,
                  image: null,
                  active: true,
                },
              })
            }
          >
            + ADD SLIDE
          </Button>
        </div>
      </div>

      {slides.length === 0 ? (
        <EmptyState
          title="No slides yet"
          hint="The homepage will show its built-in default content until a slide is added."
        />
      ) : (
        <div className="space-y-3">
          {slides.map((s, index) => (
            <div
              key={s.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(index)}
              className={`flex flex-wrap items-center gap-3 border border-line p-3 ${
                dragIndex === index ? "opacity-60" : ""
              }`}
            >
              <span className="label cursor-grab select-none text-stone" title="Drag to reorder">
                ⋮⋮
              </span>
              <div className="h-16 w-12 shrink-0 border border-line bg-mist overflow-hidden">
                {s.image?.url ? (
                  <img src={s.image.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="label flex h-full items-center justify-center text-[9px] text-stone">
                    —
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{s.title}</p>
                <p className="truncate text-[12px] text-stone">{s.eyebrow}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <VisibilityBadge active={s.active} />
                  {!s.mediaId && <Badge tone="warn">NO IMAGE</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move ${s.title} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move ${s.title} down`}
                  disabled={index === slides.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleActive.mutate({ row: s })}
                  title="Toggle LIVE / HIDDEN"
                >
                  {s.active ? "HIDE" : "SHOW"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSlide({
                      id: s.id,
                      form: {
                        eyebrow: s.eyebrow ?? "",
                        title: s.title,
                        subtitle: s.subtitle ?? "",
                        ctaLabel: s.ctaLabel ?? "",
                        ctaUrl: s.ctaUrl ?? "",
                        mediaId: s.mediaId,
                        image: s.image,
                        active: s.active,
                        sort: s.sort,
                      },
                    })
                  }
                >
                  EDIT
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="!text-danger"
                  onClick={() => setConfirmDelete(s)}
                >
                  DEL
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!slide}
        onClose={() => setSlide(null)}
        title={slide?.id ? "Edit slide" : "New slide"}
        wide
      >
        {slide && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (ctaUrlError(slide.form.ctaUrl)) {
                toast.push("CTA URL must be /internal-path or https://…", "danger");
                return;
              }
              save.mutate({
                id: slide.id,
                body: {
                  eyebrow: slide.form.eyebrow || null,
                  title: slide.form.title,
                  subtitle: slide.form.subtitle || null,
                  ctaLabel: slide.form.ctaLabel || null,
                  ctaUrl: slide.form.ctaUrl || null,
                  mediaId: slide.form.mediaId || null,
                  sort: slide.form.sort ?? 0,
                  active: slide.form.active !== false,
                },
              });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Eyebrow">
                <TextInput
                  value={slide.form.eyebrow}
                  onChange={(e) => setSlide((s) => ({ ...s, form: { ...s.form, eyebrow: e.target.value } }))}
                />
              </Field>
              <Field label="Title (required)">
                <TextInput
                  value={slide.form.title}
                  onChange={(e) => setSlide((s) => ({ ...s, form: { ...s.form, title: e.target.value } }))}
                  required
                />
              </Field>
              <Field label="Subtitle" className="sm:col-span-2">
                <TextInput
                  value={slide.form.subtitle}
                  onChange={(e) => setSlide((s) => ({ ...s, form: { ...s.form, subtitle: e.target.value } }))}
                />
              </Field>
              <Field label="CTA label">
                <TextInput
                  value={slide.form.ctaLabel}
                  onChange={(e) => setSlide((s) => ({ ...s, form: { ...s.form, ctaLabel: e.target.value } }))}
                />
              </Field>
              <Field
                label="CTA URL"
                hint="/shop or https://example.com"
                error={ctaUrlError(slide.form.ctaUrl)}
              >
                <TextInput
                  value={slide.form.ctaUrl}
                  onChange={(e) => setSlide((s) => ({ ...s, form: { ...s.form, ctaUrl: e.target.value } }))}
                />
              </Field>
            </div>

            <Field label="Image">
              <div className="flex items-center gap-3">
                <div className="h-20 w-16 shrink-0 border border-line bg-mist overflow-hidden">
                  {slide.form.image?.url ? (
                    <img src={slide.form.image.url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="label flex h-full items-center justify-center text-[9px] text-stone">
                      NONE
                    </div>
                  )}
                </div>
                <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>
                  {slide.form.mediaId ? "Change image" : "Choose image"}
                </Button>
                {slide.form.mediaId && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setSlide((s) => ({ ...s, form: { ...s.form, mediaId: null, image: null } }))
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
              <p className="mt-1 text-[12px] text-stone">
                Slides without an image still appear, with a placeholder.
              </p>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <Checkbox
                  label="Live on the site"
                  checked={slide.form.active !== false}
                  onChange={(e) =>
                    setSlide((s) => ({ ...s, form: { ...s.form, active: e.target.checked } }))
                  }
                />
                <div className="space-y-1">
                  <p className="label text-stone">Live preview</p>
                  <HeroPreview form={slide.form} />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setSlide(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                Save slide
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Slide image"
        onSelect={([id], items = []) => {
          const media = items[0] ?? null;
          setSlide((s) => ({
            ...s,
            form: {
              ...s.form,
              mediaId: id,
              image: media
                ? { url: media.url, width: media.width, height: media.height, alt: media.alt }
                : s.form.image,
            },
          }));
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete slide"
        message={`Delete “${confirmDelete?.title}”? The homepage updates immediately.`}
        confirmLabel="Delete"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          remove.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------- lookbook */
function LookbookEditor() {
  const qc = useQueryClient();
  const toast = useToast();
  const content = useQuery({
    queryKey: ["admin-content"],
    queryFn: () => api("/admin/content").then((r) => r.data),
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-content"] });

  const add = useMutation({
    mutationFn: async (mediaIds) => {
      for (const mediaId of mediaIds) {
        await api("/admin/content/lookbook", { method: "POST", body: { mediaId } });
      }
    },
    onSuccess: async () => {
      invalidate();
      const check = await liveCheck("/lookbook", (data) => (data ?? []).length > 0);
      toast.push(
        check.ok ? "LIVE ON SITE ✓" : `SAVED — NOT VISIBLE ON SITE (${check.reason})`,
        check.ok ? "ink" : "danger",
      );
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const update = useMutation({
    mutationFn: ({ id, body }) =>
      api(`/admin/content/lookbook/${id}`, { method: "PUT", body }),
    onSuccess: async (_res, variables) => {
      invalidate();
      setEditing(null);
      const check = await liveCheck("/home", (data) =>
        variables.body.active === false
          ? true
          : (data?.lookbook ?? []).some((l) => l.id === variables.id),
      );
      toast.push(
        variables.body.active === false
          ? "Saved · HIDDEN (not shown on the site)"
          : check.ok
            ? "LIVE ON SITE ✓"
            : `SAVED — NOT VISIBLE ON SITE (${check.reason})`,
        check.ok ? "ink" : "danger",
      );
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/content/lookbook/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.push("Removed from lookbook");
      invalidate();
    },
  });

  const reorder = useMutation({
    mutationFn: (ids) => api("/admin/content/lookbook/reorder", { method: "PUT", body: { ids } }),
    onSuccess: () => {
      toast.push("Order saved");
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  if (content.isLoading) return <Spinner />;
  const items = content.data?.lookbook ?? [];
  const ids = items.map((l) => l.id);
  const remaining = Math.max(0, 24 - items.length);

  const move = (index, delta) => {
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    reorder.mutate(moveItem(ids, index, to));
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label text-graphite">
            LOOKBOOK ({items.length}) — first 4 appear on the homepage; all appear on /lookbook
          </p>
          <p className="mt-1 text-[12px] text-stone">Max 24. Tiles are shown 3:4, grayscale.</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            className="label text-stone underline hover:text-ink"
            href={`${SITE_URL}/lookbook?debug=1`}
            target="_blank"
            rel="noopener noreferrer"
          >
            VIEW ON SITE ↗
          </a>
          <Button size="sm" disabled={remaining === 0} onClick={() => setPickerOpen(true)}>
            + ADD IMAGES
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No lookbook images yet"
          hint="The homepage shows its default tiles until images are added."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((l, index) => (
            <div
              key={l.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex === null || dragIndex === index) return;
                reorder.mutate(moveItem(ids, dragIndex, index));
                setDragIndex(null);
              }}
              className={`border border-line ${dragIndex === index ? "opacity-60" : ""}`}
            >
              <div className="aspect-[3/4] bg-mist overflow-hidden">
                {l.image?.url ? (
                  <img src={l.image.url} alt="" className="h-full w-full object-cover grayscale" />
                ) : (
                  <div className="label flex h-full items-center justify-center text-[10px] text-stone">
                    NO IMAGE
                  </div>
                )}
              </div>
              <div className="space-y-1 p-2">
                <VisibilityBadge active={l.active} />
                <p className="truncate text-[11px] text-stone">{l.caption || "No caption"}</p>
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => move(index, -1)}>
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>
                    EDIT
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="!text-danger"
                    onClick={() => remove.mutate(l.id)}
                  >
                    REMOVE
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <MediaPicker
        open={pickerOpen}
        multiple
        max={remaining}
        selectedIds={[]}
        onClose={() => setPickerOpen(false)}
        title="Add to lookbook"
        onSelect={(mediaIds) => {
          const images = items.map((l) => l.mediaId);
          const duplicates = mediaIds.filter((id) => images.includes(id));
          if (duplicates.length && !window.confirm("Some of these images are already in the lookbook. Add anyway?")) {
            return;
          }
          add.mutate(mediaIds);
        }}
      />

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit lookbook tile">
        {editing && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (ctaUrlError(editing.linkUrl)) {
                toast.push("Link must be /internal-path or https://…", "danger");
                return;
              }
              update.mutate({
                id: editing.id,
                body: {
                  mediaId: editing.mediaId,
                  caption: editing.caption || null,
                  linkUrl: editing.linkUrl || null,
                  sort: editing.sort ?? 0,
                  active: editing.active !== false,
                },
              });
            }}
          >
            <Field label="Caption (optional)">
              <TextInput
                value={editing.caption ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s, caption: e.target.value }))}
              />
            </Field>
            <Field label="Link URL (optional)" error={ctaUrlError(editing.linkUrl)}>
              <TextInput
                value={editing.linkUrl ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s, linkUrl: e.target.value }))}
              />
            </Field>
            <Checkbox
              label="Live on the site"
              checked={editing.active !== false}
              onChange={(e) => setEditing((s) => ({ ...s, active: e.target.checked }))}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                Save tile
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------------------ page */
export default function ContentAdmin() {
  const products = useQuery({
    queryKey: ["admin-products-select"],
    queryFn: () => api("/admin/products?limit=60").then((r) => r.data),
  });

  return (
    <div>
      <PageHeader title="Homepage content">
        <span className="label text-stone">
          {SETTINGS_KEYS.CONTENT_VERSION} syncs the storefront after every save
        </span>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard
          settingKey="promo_bar"
          title="Promo bar"
          liveCheckPath="/home"
          liveCheckPredicate={(data) => (data?.promoBar?.text ?? "").length > 0}
          render={(v, set) => (
            <div className="space-y-3">
              <Field label="Text">
                <TextInput value={v.text ?? ""} onChange={(e) => set({ ...v, text: e.target.value })} />
              </Field>
              <Checkbox
                label="Show the promo bar"
                checked={!!v.active}
                onChange={(e) => set({ ...v, active: e.target.checked })}
              />
            </div>
          )}
        />

        <SettingsCard
          settingKey="shipping_banner"
          title="Shipping banner"
          liveCheckPath="/home"
          liveCheckPredicate={(data) => (data?.shippingBanner?.title ?? "").length > 0}
          render={(v, set) => (
            <div className="space-y-3">
              <Field label="Title">
                <TextInput value={v.title ?? ""} onChange={(e) => set({ ...v, title: e.target.value })} />
              </Field>
              <Field label="Subtitle" hint="Leave empty to use the free-shipping threshold.">
                <TextInput
                  value={v.subtitle ?? ""}
                  onChange={(e) => set({ ...v, subtitle: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="CTA label">
                  <TextInput
                    value={v.cta_label ?? ""}
                    onChange={(e) => set({ ...v, cta_label: e.target.value })}
                  />
                </Field>
                <Field label="CTA URL" error={ctaUrlError(v.cta_url)}>
                  <TextInput
                    value={v.cta_url ?? ""}
                    onChange={(e) => set({ ...v, cta_url: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          )}
        />

        <SettingsCard
          settingKey="showcase"
          title="Showcase product"
          liveCheckPath="/home"
          liveCheckPredicate={(data) => !!data?.showcase}
          render={(v, set) => (
            <Field label="Product">
              <Select
                value={v.product_id ?? ""}
                onChange={(e) => set({ ...v, product_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">— none —</option>
                {(products.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        />

        <SettingsCard
          settingKey="footer"
          title="Footer"
          liveCheckPath="/home"
          liveCheckPredicate={(data) => (data?.footer?.blurb ?? "").length > 0}
          render={(v, set) => (
            <div className="space-y-3">
              <Field label="Blurb">
                <TextArea rows={3} value={v.blurb ?? ""} onChange={(e) => set({ ...v, blurb: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                {["instagram", "x", "youtube", "pinterest"].map((key) => (
                  <Field key={key} label={key}>
                    <TextInput
                      value={v.social?.[key] ?? ""}
                      onChange={(e) =>
                        set({ ...v, social: { ...(v.social ?? {}), [key]: e.target.value } })
                      }
                    />
                  </Field>
                ))}
              </div>
            </div>
          )}
        />

        <SettingsCard
          settingKey="menu_feature"
          title="Menu feature tile"
          liveCheckPath="/home"
          liveCheckPredicate={(data) => !!data?.menuFeature?.title}
          render={(v, set) => <MenuFeatureFields value={v} setValue={set} />}
        />
      </div>

      <div className="mt-4">
        <HeroEditor />
      </div>
      <div className="mt-4">
        <LookbookEditor />
      </div>
    </div>
  );
}
