import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Button,
  Card,
  Checkbox,
  Field,
  Modal,
  PageHeader,
  Select,
  Spinner,
  TextArea,
  TextInput,
  useToast,
} from "../components/ui";

/* ---------------------------------------------- generic settings editor */
function SettingsCard({ settingKey, title, children, render }) {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ["setting", settingKey],
    queryFn: () => api(`/admin/settings/${settingKey}`).then((r) => r.data),
  });
  const [value, setValue] = useState(null);

  useEffect(() => {
    if (query.data !== undefined) setValue(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (v) => api(`/admin/settings/${settingKey}`, { method: "PUT", body: { value: v } }),
    onSuccess: () => {
      toast.push("Saved");
      qc.invalidateQueries({ queryKey: ["setting", settingKey] });
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

/* ------------------------------------------------------- media chooser */
function useMediaList(enabled) {
  return useQuery({
    queryKey: ["media-picker", ""],
    queryFn: () => api("/admin/media?limit=60").then((r) => r.data),
    enabled,
  });
}

/* ------------------------------------------------------------ hero rows */
function HeroEditor() {
  const qc = useQueryClient();
  const toast = useToast();
  const content = useQuery({
    queryKey: ["admin-content"],
    queryFn: () => api("/admin/content").then((r) => r.data),
  });
  const media = useMediaList(true);
  const [slide, setSlide] = useState(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-content"] });

  const save = useMutation({
    mutationFn: ({ id, body }) =>
      id
        ? api(`/admin/content/hero/${id}`, { method: "PUT", body })
        : api("/admin/content/hero", { method: "POST", body }),
    onSuccess: () => {
      toast.push("Slide saved");
      setSlide(null);
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

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="label text-graphite">Hero slides ({slides.length}/5)</p>
        <Button
          size="sm"
          onClick={() =>
            setSlide({ id: null, form: { eyebrow: "", title: "", subtitle: "", ctaLabel: "", ctaUrl: "", mediaId: null, active: true } })
          }
          disabled={slides.length >= 5}
        >
          + Add slide
        </Button>
      </div>

      <div className="space-y-3">
        {slides.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border border-line p-3">
            <div className="h-12 w-20 shrink-0 border border-line bg-mist">
              {s.image && <img src={s.image.url} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.title}</p>
              <p className="truncate text-[12px] text-stone">{s.eyebrow}</p>
            </div>
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
                    active: s.active,
                  },
                })
              }
            >
              Edit
            </Button>
            <Button size="sm" variant="ghost" className="!text-danger" onClick={() => remove.mutate(s.id)}>
              Del
            </Button>
          </div>
        ))}
      </div>

      <Modal open={!!slide} onClose={() => setSlide(null)} title={slide?.id ? "Edit slide" : "New slide"} wide>
        {slide && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({ id: slide.id, body: slide.form });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Eyebrow">
                <TextInput
                  value={slide.form.eyebrow}
                  onChange={(e) => setSlide((s) => ({ ...s, form: { ...s.form, eyebrow: e.target.value } }))}
                />
              </Field>
              <Field label="Title">
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
              <Field label="CTA URL">
                <TextInput
                  value={slide.form.ctaUrl}
                  onChange={(e) => setSlide((s) => ({ ...s, form: { ...s.form, ctaUrl: e.target.value } }))}
                />
              </Field>
            </div>
            <Field label="Image">
              <Select
                value={slide.form.mediaId ?? ""}
                onChange={(e) => setSlide((s) => ({ ...s, form: { ...s.form, mediaId: e.target.value || null } }))}
              >
                <option value="">— none —</option>
                {(media.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.filename || m.key}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox
              label="Active"
              checked={slide.form.active}
              onChange={(e) => setSlide((s) => ({ ...s, form: { ...s.form, active: e.target.checked } }))}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setSlide(null)}>
                Cancel
              </Button>
              <Button type="submit">Save slide</Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

/* --------------------------------------------------------- lookbook rows */
function LookbookEditor() {
  const qc = useQueryClient();
  const toast = useToast();
  const content = useQuery({
    queryKey: ["admin-content"],
    queryFn: () => api("/admin/content").then((r) => r.data),
  });
  const media = useMediaList(true);
  const [newMedia, setNewMedia] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-content"] });

  const add = useMutation({
    mutationFn: (mediaId) => api("/admin/content/lookbook", { method: "POST", body: { mediaId } }),
    onSuccess: () => {
      toast.push("Added to lookbook");
      setNewMedia("");
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/content/lookbook/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.push("Removed");
      invalidate();
    },
  });

  if (content.isLoading) return <Spinner />;
  const items = content.data?.lookbook ?? [];

  return (
    <Card className="p-5">
      <p className="label mb-4 text-graphite">Lookbook ({items.length})</p>
      <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
        {items.map((l) => (
          <div key={l.id} className="border border-line">
            <img src={l.image.url} alt="" className="h-20 w-full object-cover" />
            <button className="label w-full py-1 text-danger" onClick={() => remove.mutate(l.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Add image" className="min-w-[240px] flex-1">
          <Select value={newMedia} onChange={(e) => setNewMedia(e.target.value)}>
            <option value="">— choose media —</option>
            {(media.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.filename || m.key}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={() => newMedia && add.mutate(newMedia)} disabled={!newMedia}>
          Add
        </Button>
      </div>
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
      <PageHeader title="Homepage content" />

      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard
          settingKey="promo_bar"
          title="Promo bar"
          render={(v, set) => (
            <div className="space-y-3">
              <Field label="Text">
                <TextInput value={v.text ?? ""} onChange={(e) => set({ ...v, text: e.target.value })} />
              </Field>
              <Checkbox label="Active" checked={!!v.active} onChange={(e) => set({ ...v, active: e.target.checked })} />
            </div>
          )}
        />

        <SettingsCard
          settingKey="shipping_banner"
          title="Shipping banner"
          render={(v, set) => (
            <div className="space-y-3">
              <Field label="Title">
                <TextInput value={v.title ?? ""} onChange={(e) => set({ ...v, title: e.target.value })} />
              </Field>
              <Field label="Subtitle">
                <TextInput value={v.subtitle ?? ""} onChange={(e) => set({ ...v, subtitle: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="CTA label">
                  <TextInput value={v.cta_label ?? ""} onChange={(e) => set({ ...v, cta_label: e.target.value })} />
                </Field>
                <Field label="CTA URL">
                  <TextInput value={v.cta_url ?? ""} onChange={(e) => set({ ...v, cta_url: e.target.value })} />
                </Field>
              </div>
            </div>
          )}
        />

        <SettingsCard
          settingKey="showcase"
          title="Showcase product"
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
          title="Footer blurb"
          render={(v, set) => (
            <Field label="Blurb">
              <TextArea rows={3} value={v.blurb ?? ""} onChange={(e) => set({ ...v, blurb: e.target.value })} />
            </Field>
          )}
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
