import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { api } from "../lib/api";
import { centsToInput, parsePriceToCents, formatPrice } from "../lib/format";
import { uploadMedia } from "../lib/imageUpload";
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

const TABS = ["General", "Pricing", "Media", "Variants", "Features", "Related", "SEO"];
const SIZE_PRESETS = ["XS", "S", "M", "L", "XL", "XXL", "One size"];
const ICONS = ["drop", "pocket", "fit", "shield", "leaf", "bolt", "ruler", "refresh"];

const EMPTY = {
  name: "",
  slug: "",
  shortDescription: "",
  description: "",
  price_cents: 0,
  old_price_cents: null,
  categoryId: null,
  status: "draft",
  isNew: false,
  featured: false,
  customizable: false,
  printAddonCents: 0,
  sizeChartId: null,
  features: [],
  seoTitle: "",
  seoDescription: "",
  images: [],
  variants: [],
  pairWith: [],
  accessories: [],
};

/* ------------------------------------------------------- Media picker */
function MediaPicker({ open, onClose, onPick }) {
  const [q, setQ] = useState("");
  const picker = useQuery({
    queryKey: ["media-picker", q],
    queryFn: () => api(`/admin/media?limit=48&q=${encodeURIComponent(q)}`).then((r) => r.data),
    enabled: open,
  });

  return (
    <Modal open={open} onClose={onClose} title="Choose from library" wide>
      <TextInput placeholder="Search media" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
        {(picker.data ?? []).map((m) => (
          <button
            key={m.id}
            onClick={() => onPick(m)}
            className="group border border-line bg-mist p-0 text-left"
          >
            <img src={m.url} alt={m.alt ?? ""} className="h-24 w-full object-cover" />
            <span className="block truncate p-1 text-[11px] text-stone group-hover:text-ink">
              {m.filename || m.key}
            </span>
          </button>
        ))}
      </div>
      {picker.isLoading && <Spinner label="Loading media" />}
    </Modal>
  );
}

/* ------------------------------------------------------- Product editor */
export default function ProductEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("General");
  const [form, setForm] = useState(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [pickerFor, setPickerFor] = useState(null);
  const fileRef = useRef(null);

  const product = useQuery({
    queryKey: ["admin-product", id],
    queryFn: () => api(`/admin/products/${id}`).then((r) => r.data),
    enabled: !isNew,
  });

  const categories = useQuery({
    queryKey: ["admin-categories"],
    queryFn: () => api("/admin/categories").then((r) => r.data),
  });

  const sizeCharts = useQuery({
    queryKey: ["admin-size-charts"],
    queryFn: () => api("/admin/size-charts").then((r) => r.data),
  });

  useEffect(() => {
    if (product.data) {
      setForm({ ...EMPTY, ...product.data });
      setDirty(false);
    }
  }, [product.data]);

  useEffect(() => {
    const handler = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const update = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const discount = useMemo(() => {
    const p = form.price_cents;
    const o = form.old_price_cents;
    return o && o > p ? Math.round(((o - p) / o) * 100) : 0;
  }, [form.price_cents, form.old_price_cents]);

  const selectedChart =
    (sizeCharts.data ?? []).find((c) => c.id === form.sizeChartId) ?? null;

  const toPayload = () => ({
    name: form.name,
    slug: form.slug || undefined,
    shortDescription: form.shortDescription || null,
    description: form.description || null,
    price_cents: Number(form.price_cents) || 0,
    old_price_cents: form.old_price_cents ? Number(form.old_price_cents) : null,
    categoryId: form.categoryId ? Number(form.categoryId) : null,
    status: form.status,
    isNew: !!form.isNew,
    featured: !!form.featured,
    customizable: !!form.customizable,
    printAddonCents: Number(form.printAddonCents) || 0,
    sizeChartId: form.sizeChartId || null,
    features: form.features,
    seoTitle: form.seoTitle || null,
    seoDescription: form.seoDescription || null,
    images: form.images.map((img, i) => ({
      mediaId: img.mediaId,
      colorName: img.colorName || null,
      sort: i,
    })),
    variants: form.variants.map((v) => ({
      colorName: v.colorName,
      colorHex: v.colorHex,
      size: v.size,
      sku: v.sku || undefined,
      stock: Number(v.stock) || 0,
    })),
    relations: [
      ...form.pairWith.map((r, i) => ({ relatedId: r.relatedId ?? r, type: "pair", sort: i })),
      ...form.accessories.map((r, i) => ({
        relatedId: r.relatedId ?? r,
        type: "accessory",
        sort: i,
      })),
    ],
  });

  const save = useMutation({
    mutationFn: (status) => {
      const payload = { ...toPayload(), ...(status ? { status } : {}) };
      return isNew
        ? api("/admin/products", { method: "POST", body: payload })
        : api(`/admin/products/${id}`, { method: "PUT", body: payload });
    },
    onSuccess: (res) => {
      toast.push("Saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["admin-product", id] });
      if (isNew && res.data?.id) navigate(`/admin/products/${res.data.id}`, { replace: true });
    },
    onError: (err) => {
      const fields = err.fields ? Object.values(err.fields).join(" · ") : err.message;
      toast.push(fields, "danger");
    },
  });

  const onFiles = async (e) => {
    const files = [...(e.target.files ?? [])];
    if (!files.length) return;
    try {
      const res = await uploadMedia(files, "products");
      const uploaded = res?.data ?? [];
      update({
        images: [
          ...form.images,
          ...uploaded.map((m) => ({ mediaId: m.id, url: m.url, colorName: null })),
        ],
      });
      toast.push(`${uploaded.length} image(s) uploaded`);
    } catch (err) {
      toast.push(err.message, "danger");
    }
    e.target.value = "";
  };

  const moveImage = (index, delta) => {
    const next = [...form.images];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update({ images: next });
  };

  const addColor = (name, hex) => {
    if (!name) return;
    const sizes = [...new Set(form.variants.map((v) => v.size))];
    const next = [...form.variants];
    for (const size of sizes.length ? sizes : ["One size"]) {
      if (!next.some((v) => v.colorName === name && v.size === size)) {
        next.push({ colorName: name, colorHex: hex, size, sku: "", stock: 0 });
      }
    }
    update({ variants: next });
  };

  const addSize = (size) => {
    const colors = [...new Set(form.variants.map((v) => v.colorName))];
    const hexOf = (n) => form.variants.find((v) => v.colorName === n)?.colorHex ?? "#000000";
    const next = [...form.variants];
    const list = colors.length ? colors : ["Black"];
    for (const color of list) {
      if (!next.some((v) => v.colorName === color && v.size === size)) {
        next.push({ colorName: color, colorHex: hexOf(color), size, sku: "", stock: 0 });
      }
    }
    update({ variants: next });
  };

  const pickMedia = (m) => {
    if (pickerFor === "library") {
      update({ images: [...form.images, { mediaId: m.id, url: m.url, colorName: null }] });
    }
    setPickerFor(null);
  };

  if (product.isLoading) return <Spinner />;

  return (
    <div className="pb-24">
      <PageHeader title={isNew ? "New product" : form.name || "Product"}>
        {dirty && <span className="label text-warn">Unsaved changes</span>}
        <Button variant="outline" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
          Save
        </Button>
        <Button onClick={() => save.mutate("published")} disabled={save.isPending}>
          Save & publish
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`label px-4 py-2.5 ${
              tab === t ? "border-b-2 border-ink text-ink" : "text-stone hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "General" && (
        <Card className="grid gap-4 p-5 lg:grid-cols-2">
          <Field label="Name" className="lg:col-span-2">
            <TextInput value={form.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <Field label="Slug" hint="Leave blank to auto-generate">
            <TextInput value={form.slug} onChange={(e) => update({ slug: e.target.value })} />
          </Field>
          <Field label="Category">
            <Select
              value={form.categoryId ?? ""}
              onChange={(e) => update({ categoryId: e.target.value || null })}
            >
              <option value="">— none —</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Size chart"
            hint={
              sizeCharts.data?.length === 0
                ? "No charts yet — create one under Size charts."
                : "Optional — shown on the product page."
            }
          >
            <Select
              value={form.sizeChartId ?? ""}
              onChange={(e) => update({ sizeChartId: e.target.value || null })}
            >
              <option value="">— none —</option>
              {(sizeCharts.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Short description" className="lg:col-span-2">
            <TextInput
              value={form.shortDescription ?? ""}
              onChange={(e) => update({ shortDescription: e.target.value })}
            />
          </Field>
          <Field label="Description" className="lg:col-span-2">
            <TextArea
              rows={6}
              value={form.description ?? ""}
              onChange={(e) => update({ description: e.target.value })}
            />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => update({ status: e.target.value })}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
          <div className="flex flex-wrap items-end gap-4">
            <Checkbox label="New" checked={form.isNew} onChange={(e) => update({ isNew: e.target.checked })} />
            <Checkbox label="Featured" checked={form.featured} onChange={(e) => update({ featured: e.target.checked })} />
          </div>
          {selectedChart && (
            <div className="overflow-x-auto border border-line lg:col-span-2">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-mist">
                    <th className="label px-3 py-2 text-stone">Measurement</th>
                    {(selectedChart.sizes ?? []).map((size, i) => (
                      <th key={`${size}-${i}`} className="label px-3 py-2 text-stone">
                        {size}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(selectedChart.measurements ?? {}).map(([name, values]) => (
                    <tr key={name} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">{name}</td>
                      {(selectedChart.sizes ?? []).map((size, i) => (
                        <td key={`${size}-${i}`} className="px-3 py-2 text-stone">
                          {values[i] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-line px-3 py-2 text-[12px] text-stone">
                {selectedChart.title} · {selectedChart.unit} · garment-side
              </p>
            </div>
          )}
        </Card>
      )}

      {tab === "Pricing" && (
        <Card className="grid gap-4 p-5 lg:grid-cols-3">
          <Field label="Price (EUR)">
            <TextInput
              value={centsToInput(form.price_cents)}
              onChange={(e) => update({ price_cents: parsePriceToCents(e.target.value) })}
            />
          </Field>
          <Field label="Compare-at price" hint={discount ? `${discount}% off` : "Optional"}>
            <TextInput
              value={form.old_price_cents ? centsToInput(form.old_price_cents) : ""}
              onChange={(e) =>
                update({ old_price_cents: e.target.value ? parsePriceToCents(e.target.value) : null })
              }
            />
          </Field>
          <div className="flex items-end gap-3">
            <Checkbox
              label="Customizable"
              checked={form.customizable}
              onChange={(e) => update({ customizable: e.target.checked })}
            />
          </div>
          {form.customizable && (
            <Field label="Print add-on (EUR)">
              <TextInput
                value={centsToInput(form.printAddonCents)}
                onChange={(e) => update({ printAddonCents: parsePriceToCents(e.target.value) })}
              />
            </Field>
          )}
        </Card>
      )}

      {tab === "Media" && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              Upload images
            </Button>
            <Button variant="ghost" onClick={() => setPickerFor("library")}>
              Choose from library
            </Button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
          </div>
          <p className="mb-3 text-[12px] text-stone">
            First image is the main image. Images are resized to ≤2000px and converted to WebP.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {form.images.map((img, i) => (
              <div key={`${img.mediaId}-${i}`} className="border border-line bg-mist">
                <img src={img.url} alt="" className="h-32 w-full object-cover" />
                <div className="flex items-center justify-between p-2">
                  <span className="label text-stone">{i === 0 ? "Main" : `#${i + 1}`}</span>
                  <div className="flex gap-1">
                    <button className="label text-stone hover:text-ink" onClick={() => moveImage(i, -1)}>
                      ←
                    </button>
                    <button className="label text-stone hover:text-ink" onClick={() => moveImage(i, 1)}>
                      →
                    </button>
                    <button
                      className="label text-danger"
                      onClick={() => update({ images: form.images.filter((_, x) => x !== i) })}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "Variants" && (
        <Card className="p-5">
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="label mb-2 text-graphite">Add color</p>
              <div className="flex gap-2">
                <TextInput
                  id="new-color-name"
                  placeholder="Name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      addColor(e.target.value, "#000000");
                      e.target.value = "";
                    }
                  }}
                />
                <input
                  id="new-color-hex"
                  type="color"
                  defaultValue="#000000"
                  className="h-[42px] w-12 border border-line"
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    const name = document.getElementById("new-color-name").value;
                    const hex = document.getElementById("new-color-hex").value;
                    addColor(name, hex);
                    document.getElementById("new-color-name").value = "";
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
            <div>
              <p className="label mb-2 text-graphite">Add size</p>
              <div className="flex flex-wrap gap-2">
                {SIZE_PRESETS.map((s) => (
                  <Button key={s} size="sm" variant="ghost" onClick={() => addSize(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {form.variants.length === 0 ? (
            <p className="text-[13px] text-stone">No variants yet — add a color or size above.</p>
          ) : (
            <div className="overflow-x-auto border border-line">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line">
                    {["Color", "Size", "SKU", "Stock", ""].map((h) => (
                      <th key={h} className="label px-3 py-2 text-stone">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {form.variants.map((v, i) => (
                    <tr key={`${v.colorName}-${v.size}-${i}`} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-3 w-3 border border-line" style={{ background: v.colorHex }} />
                          {v.colorName}
                        </span>
                      </td>
                      <td className="px-3 py-2">{v.size}</td>
                      <td className="px-3 py-2">
                        <TextInput
                          className="!py-1.5 !text-[12px]"
                          value={v.sku ?? ""}
                          placeholder="auto"
                          onChange={(e) => {
                            const next = [...form.variants];
                            next[i] = { ...v, sku: e.target.value };
                            update({ variants: next });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <TextInput
                          type="number"
                          min="0"
                          className="!w-24 !py-1.5"
                          value={v.stock}
                          onChange={(e) => {
                            const next = [...form.variants];
                            next[i] = { ...v, stock: Number(e.target.value) };
                            update({ variants: next });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          className="label text-danger"
                          onClick={() => update({ variants: form.variants.filter((_, x) => x !== i) })}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "Features" && (
        <Card className="p-5">
          {form.features.map((f, i) => (
            <div key={i} className="mb-3 grid gap-2 sm:grid-cols-[140px_1fr_1fr_auto]">
              <Select
                value={f.icon}
                onChange={(e) => {
                  const next = [...form.features];
                  next[i] = { ...f, icon: e.target.value };
                  update({ features: next });
                }}
              >
                {ICONS.map((ic) => (
                  <option key={ic} value={ic}>
                    {ic}
                  </option>
                ))}
              </Select>
              <TextInput
                placeholder="Title"
                value={f.title}
                onChange={(e) => {
                  const next = [...form.features];
                  next[i] = { ...f, title: e.target.value };
                  update({ features: next });
                }}
              />
              <TextInput
                placeholder="Subtitle"
                value={f.sub}
                onChange={(e) => {
                  const next = [...form.features];
                  next[i] = { ...f, sub: e.target.value };
                  update({ features: next });
                }}
              />
              <Button
                variant="ghost"
                className="!text-danger"
                onClick={() => update({ features: form.features.filter((_, x) => x !== i) })}
              >
                Remove
              </Button>
            </div>
          ))}
          {form.features.length < 3 && (
            <Button
              variant="outline"
              onClick={() => update({ features: [...form.features, { icon: "shield", title: "", sub: "" }] })}
            >
              + Add feature
            </Button>
          )}
        </Card>
      )}

      {tab === "Related" && (
        <RelationPicker
          label="Pair it with"
          items={form.pairWith}
          excludeId={id}
          onChange={(items) => update({ pairWith: items })}
        />
      )}

      {tab === "Related" && (
        <RelationPicker
          label="Accessories"
          items={form.accessories}
          excludeId={id}
          onChange={(items) => update({ accessories: items })}
        />
      )}

      {tab === "SEO" && (
        <Card className="grid gap-4 p-5">
          <Field label={`SEO title (${(form.seoTitle ?? "").length}/60)`}>
            <TextInput value={form.seoTitle ?? ""} onChange={(e) => update({ seoTitle: e.target.value })} />
          </Field>
          <Field label={`SEO description (${(form.seoDescription ?? "").length}/160)`}>
            <TextArea
              rows={3}
              value={form.seoDescription ?? ""}
              onChange={(e) => update({ seoDescription: e.target.value })}
            />
          </Field>
          <div className="border border-line bg-mist p-4">
            <p className="text-[13px] text-graphite">{form.seoTitle || form.name}</p>
            <p className="text-[12px] text-stone">afreak.com/products/{form.slug || "…"}</p>
            <p className="mt-1 text-[12px] text-stone">
              {form.seoDescription || form.shortDescription || "No description"}
            </p>
          </div>
        </Card>
      )}

      {/* Sticky mobile save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card p-3 lg:hidden">
        <Button className="w-full" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
          Save
        </Button>
      </div>

      <MediaPicker open={pickerFor === "library"} onClose={() => setPickerFor(null)} onPick={pickMedia} />
    </div>
  );
}

/* -------------------------------------------------- Relation picker */
function RelationPicker({ label, items, excludeId, onChange }) {
  const [q, setQ] = useState("");
  const search = useQuery({
    queryKey: ["relation-search", q],
    queryFn: () => api(`/admin/products?q=${encodeURIComponent(q)}&limit=8`).then((r) => r.data),
    enabled: q.length > 1,
  });

  const chosenIds = new Set(items.map((i) => i.relatedId ?? i));

  return (
    <Card className="mt-4 p-5">
      <p className="label mb-3 text-graphite">{label}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {items.map((r, i) => (
          <span key={i} className="label inline-flex items-center gap-2 border border-line px-2 py-1">
            {r.name ?? `#${r.relatedId ?? r}`}
            <button className="text-danger" onClick={() => onChange(items.filter((_, x) => x !== i))}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <TextInput placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2">
        {(search.data ?? [])
          .filter((p) => String(p.id) !== String(excludeId) && !chosenIds.has(p.id))
          .map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onChange([...items, { relatedId: p.id, name: p.name }]);
                setQ("");
              }}
              className="flex w-full items-center gap-3 border-b border-line px-1 py-2 text-left text-[13px] hover:bg-mist"
            >
              <span className="h-8 w-8 border border-line bg-mist">
                {p.image && <img src={p.image.url} alt="" className="h-full w-full object-cover" />}
              </span>
              {p.name}
            </button>
          ))}
      </div>
    </Card>
  );
}
