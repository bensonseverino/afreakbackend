import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { api } from "../lib/api";
import { formatPrice } from "../lib/format";
import { uploadMedia } from "../lib/imageUpload";
import {
  Button,
  Card,
  Checkbox,
  Field,
  Modal,
  MoneyInput,
  PageHeader,
  Select,
  Spinner,
  TextArea,
  TextInput,
  useToast,
} from "../components/ui";

const TABS = ["General", "Pricing", "Colors & Images", "Variants", "Features", "Related", "SEO"];

const SIZE_TYPES = [
  { value: "apparel", label: "APPAREL (XS–XXL)" },
  { value: "print", label: "PRINT (A4 · A3 · A2)" },
  { value: "one_size", label: "ONE SIZE" },
];

const DEFAULT_PRESETS = {
  apparel: ["XS", "S", "M", "L", "XL", "XXL"],
  print: ["A4", "A3", "A2"],
  one_size: ["One size"],
};

const PALETTE = [
  "#000000", "#FFFFFF", "#8A8A8A", "#C0392B", "#1F4E9C", "#3C6E47",
  "#D9A400", "#6B4A2F", "#EFE6D5", "#E8B4B8", "#7D5BA6", "#E07A3F",
];

const ICONS = ["drop", "pocket", "fit", "shield", "leaf", "bolt", "ruler", "refresh"];

const EMPTY = {
  name: "",
  slug: "",
  shortDescription: "",
  description: "",
  price_cents: 0,
  old_price_cents: null,
  sizeType: "apparel",
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
  colors: [],
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
  const [pickerFor, setPickerFor] = useState(false);
  const [imageGroup, setImageGroup] = useState("");
  const [uploading, setUploading] = useState(false);
  const [bulk, setBulk] = useState({ size: "", price: null });
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

  const currencySetting = useQuery({
    queryKey: ["setting", "currency"],
    queryFn: () => api("/admin/settings/currency").then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const presetSetting = useQuery({
    queryKey: ["setting", "size_presets"],
    queryFn: () => api("/admin/settings/size_presets").then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const currency = {
    code: currencySetting.data?.code || "KES",
    locale: currencySetting.data?.locale || "en-KE",
  };
  const money = (minor) => formatPrice(minor, currency.code, currency.locale);
  const presets = { ...DEFAULT_PRESETS, ...(presetSetting.data ?? {}) };
  const presetSizes = presets[form.sizeType] ?? presets.apparel;

  useEffect(() => {
    if (product.data) {
      const d = product.data;
      const colorValues =
        (d.options ?? []).find((o) => o.type === "color")?.values ?? [];
      const colors = colorValues
        .filter((v) => v.value !== "Default")
        .map((v) => ({ name: v.value, hex: v.swatchHex || "#000000" }));
      const fallbackColors = colors.length
        ? colors
        : [
            ...new Map(
              (d.variants ?? [])
                .filter((v) => v.colorName && v.colorName !== "Default")
                .map((v) => [v.colorName, { name: v.colorName, hex: v.colorHex || "#000000" }]),
            ).values(),
          ];
      setForm({
        ...EMPTY,
        ...d,
        sizeType: d.sizeType ?? "apparel",
        colors: fallbackColors,
        images: (d.images ?? []).map((img, index) => ({
          mediaId: img.mediaId,
          url: img.url,
          colorName: img.colorName || null,
          alt: img.alt || "",
          sort: img.sort ?? index,
        })),
        variants: (d.variants ?? []).map((v) => ({
          ...v,
          colorName: v.colorName === "Default" ? "" : v.colorName,
          priceCents: v.priceCents ?? null,
          compareAtPriceCents: v.compareAtPriceCents ?? null,
        })),
      });
      setImageGroup("");
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

  const sizes = useMemo(
    () => [...new Set(form.variants.map((v) => v.size).filter(Boolean))],
    [form.variants],
  );

  const priceRange = useMemo(() => {
    const isPrint = form.sizeType === "print";
    const prices = form.variants
      .map((v) => v.priceCents ?? (isPrint ? null : Number(form.price_cents)))
      .filter((n) => n != null && n > 0);
    if (!prices.length) {
      const base = Number(form.price_cents) || 0;
      return { from: base, to: base };
    }
    return { from: Math.min(...prices), to: Math.max(...prices) };
  }, [form.variants, form.price_cents, form.sizeType]);

  const totalStock = useMemo(
    () => form.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0),
    [form.variants],
  );

  const printPriceMissing =
    form.sizeType === "print" && form.variants.some((v) => !v.priceCents || v.priceCents <= 0);

  const discount = useMemo(() => {
    const p = Number(form.price_cents) || 0;
    const o = form.old_price_cents;
    return o && o > p ? Math.round(((o - p) / o) * 100) : 0;
  }, [form.price_cents, form.old_price_cents]);

  const selectedChart =
    (sizeCharts.data ?? []).find((c) => c.id === form.sizeChartId) ?? null;

  const toPayload = () => {
    const options = [];
    if (form.colors.length) {
      options.push({
        name: "Color",
        type: "color",
        position: 0,
        values: form.colors.map((c, i) => ({ value: c.name, swatchHex: c.hex, position: i })),
      });
    }
    if (sizes.length) {
      options.push({
        name: "Size",
        type: "size",
        position: options.length,
        values: sizes.map((s, i) => ({ value: s, position: i })),
      });
    }

    return {
      name: form.name,
      slug: form.slug || undefined,
      shortDescription: form.shortDescription || null,
      description: form.description || null,
      price_cents: Number(form.price_cents) || 0,
      old_price_cents: form.old_price_cents ? Number(form.old_price_cents) : null,
      sizeType: form.sizeType,
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
      options,
      images: form.images.map((img, i) => ({
        mediaId: img.mediaId,
        colorName: img.colorName || null,
        alt: img.alt || null,
        sort: i,
        isPrimary: i === form.images.findIndex((x) => (x.colorName || "") === (img.colorName || "")),
      })),
      variants: form.variants.map((v) => ({
        colorName: v.colorName || "",
        colorHex: v.colorHex || "#000000",
        size: v.size,
        sku: v.sku || undefined,
        stock: Number(v.stock) || 0,
        priceCents: v.priceCents ?? null,
        compareAtPriceCents: v.compareAtPriceCents ?? null,
      })),
      relations: [
        ...form.pairWith.map((r, i) => ({ relatedId: r.relatedId ?? r, type: "pair", sort: i })),
        ...form.accessories.map((r, i) => ({ relatedId: r.relatedId ?? r, type: "accessory", sort: i })),
      ],
    };
  };

  const save = useMutation({
    mutationFn: (status) => {
      if (printPriceMissing) throw new Error("Every print size needs its own price");
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

  /* ------------------------------------------------- colour handlers */
  const addColor = (name, hex) => {
    const clean = (name || "").trim();
    if (!clean) return;
    if (form.colors.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
      toast.push("That colour already exists", "danger");
      return;
    }
    const next = [
      ...form.colors,
      { name: clean, hex: hex || "#000000" },
    ];
    const variants = [...form.variants];
    for (const size of sizes.length ? sizes : []) {
      if (!variants.some((v) => v.colorName === clean && v.size === size)) {
        variants.push({
          colorName: clean,
          colorHex: hex || "#000000",
          size,
          sku: "",
          stock: 0,
          priceCents: null,
          compareAtPriceCents: null,
        });
      }
    }
    update({ colors: next, variants });
  };

  const removeColor = (name) => {
    if (!window.confirm("Its variants will be deleted and its images become shared.")) return;
    update({
      colors: form.colors.filter((c) => c.name !== name),
      variants: form.variants.filter((v) => v.colorName !== name),
      images: form.images.map((img) => (img.colorName === name ? { ...img, colorName: null } : img)),
    });
    if (imageGroup === name) setImageGroup("");
  };

  const addSize = (label) => {
    const clean = (label || "").trim();
    if (!clean || sizes.includes(clean)) return;
    const variants = [...form.variants];
    const targets = form.colors.length
      ? form.colors.map((c) => ({ name: c.name, hex: c.hex }))
      : [{ name: "", hex: "#000000" }];
    for (const target of targets) {
      if (!variants.some((v) => v.colorName === target.name && v.size === clean)) {
        variants.push({
          colorName: target.name,
          colorHex: target.hex,
          size: clean,
          sku: "",
          stock: 0,
          priceCents: null,
          compareAtPriceCents: null,
        });
      }
    }
    update({ variants });
  };

  const removeSize = (label) => {
    update({ variants: form.variants.filter((v) => v.size !== label) });
  };

  const setVariant = (index, patch) => {
    const next = [...form.variants];
    next[index] = { ...next[index], ...patch };
    update({ variants: next });
  };

  const applyBulkPrice = () => {
    if (!bulk.size || bulk.price == null) return;
    update({
      variants: form.variants.map((v) =>
        v.size === bulk.size ? { ...v, priceCents: bulk.price } : v,
      ),
    });
    toast.push(`Price set for ${bulk.size}`);
  };

  const changeSizeType = (value) => {
    if (value === form.sizeType) return;
    if (form.variants.length && !window.confirm(
      "Changing the size type does not delete existing variants. Add the new sizes in the Variants tab.",
    )) {
      return;
    }
    update({ sizeType: value });
  };

  /* -------------------------------------------------- image handlers */
  const groupImages = form.images.filter((img) => (img.colorName || "") === imageGroup);

  const onFiles = async (e) => {
    const files = [...(e.target.files ?? [])];
    if (!files.length) return;
    setUploading(true);
    try {
      const res = await uploadMedia(files, "products");
      const uploaded = res?.data ?? [];
      update({
        images: [
          ...form.images,
          ...uploaded.map((m) => ({
            mediaId: m.id,
            url: m.url,
            colorName: imageGroup || null,
            alt: "",
          })),
        ],
      });
      toast.push(`${uploaded.length} image(s) uploaded`);
    } catch (err) {
      toast.push(err.message, "danger");
    } finally {
      setUploading(false);
    }
    e.target.value = "";
  };

  const moveImage = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= form.images.length) return;
    if ((form.images[target].colorName || "") !== imageGroup) return;
    const next = [...form.images];
    [next[index], next[target]] = [next[target], next[index]];
    update({ images: next });
  };

  const removeImage = (index) => {
    update({ images: form.images.filter((_, i) => i !== index) });
  };

  const moveImageTo = (index, colorName) => {
    const next = [...form.images];
    next[index] = { ...next[index], colorName: colorName || null };
    update({ images: next });
  };

  const pickMedia = (m) => {
    update({
      images: [
        ...form.images,
        { mediaId: m.id, url: m.url, colorName: imageGroup || null, alt: "" },
      ],
    });
    setPickerFor(false);
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

          <div className="lg:col-span-2">
            <p className="label mb-2 text-graphite">Size type</p>
            <div className="flex flex-wrap gap-2">
              {SIZE_TYPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => changeSizeType(option.value)}
                  className={`label border px-3 py-2 ${
                    form.sizeType === option.value
                      ? "border-ink bg-ink text-paper"
                      : "border-line text-graphite hover:border-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

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
          <Field
            label={form.sizeType === "print" ? "Fallback price (optional)" : `Base price (${currency.code})`}
            hint={
              form.sizeType === "print"
                ? "Prices are set per size in the Variants tab."
                : "Variants can have their own price. Leave a variant price empty to use the base price."
            }
          >
            <MoneyInput
              value={form.price_cents}
              currency={currency.code}
              locale={currency.locale}
              onChange={(v) => update({ price_cents: v ?? 0 })}
            />
          </Field>
          <Field label={`Compare-at price (${currency.code})`} hint={discount ? `${discount}% off` : "Optional"}>
            <MoneyInput
              value={form.old_price_cents}
              allowEmpty
              currency={currency.code}
              locale={currency.locale}
              onChange={(v) => update({ old_price_cents: v })}
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
            <Field label={`Print add-on (${currency.code})`}>
              <MoneyInput
                value={form.printAddonCents}
                currency={currency.code}
                locale={currency.locale}
                onChange={(v) => update({ printAddonCents: v ?? 0 })}
              />
            </Field>
          )}
          <div className="border border-line bg-mist p-4 lg:col-span-2">
            <p className="label text-stone">Effective price range</p>
            <p className="mt-1 text-[15px]">
              {priceRange.to > priceRange.from
                ? `${money(priceRange.from)} – ${money(priceRange.to)}`
                : money(priceRange.from)}
            </p>
            <p className="mt-1 text-[12px] text-stone">Total stock: {totalStock}</p>
          </div>
        </Card>
      )}

      {tab === "Colors & Images" && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card className="p-5">
            <p className="label mb-3 text-graphite">Colors</p>
            {form.colors.length === 0 && (
              <p className="mb-3 text-[13px] text-stone">
                No colours. Products without colours (prints, one-size items) use shared images.
              </p>
            )}
            <div className="space-y-2">
              {form.colors.map((color, index) => (
                <div key={color.name} className="flex items-center gap-2 border border-line px-2 py-2">
                  <span className="h-5 w-5 shrink-0 border border-line" style={{ background: color.hex }} />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                    value={color.name}
                    onChange={(e) => {
                      const previous = color.name;
                      const nextName = e.target.value;
                      update({
                        colors: form.colors.map((c, i) => (i === index ? { ...c, name: nextName } : c)),
                        variants: form.variants.map((v) =>
                          v.colorName === previous ? { ...v, colorName: nextName } : v,
                        ),
                        images: form.images.map((img) =>
                          img.colorName === previous ? { ...img, colorName: nextName } : img,
                        ),
                      });
                      if (imageGroup === previous) setImageGroup(nextName);
                    }}
                  />
                  <input
                    type="color"
                    value={color.hex}
                    className="h-8 w-9 border border-line"
                    onChange={(e) =>
                      update({
                        colors: form.colors.map((c, i) => (i === index ? { ...c, hex: e.target.value } : c)),
                        variants: form.variants.map((v) =>
                          v.colorName === color.name ? { ...v, colorHex: e.target.value } : v,
                        ),
                      })
                    }
                  />
                  <button className="label text-danger" onClick={() => removeColor(color.name)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <ColorAdder onAdd={addColor} />
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setImageGroup("")}
                className={`label border px-3 py-1.5 ${
                  imageGroup === "" ? "border-ink bg-ink text-paper" : "border-line text-stone hover:text-ink"
                }`}
              >
                Shared ({form.images.filter((i) => !i.colorName).length})
              </button>
              {form.colors.map((c) => {
                const count = form.images.filter((i) => i.colorName === c.name).length;
                const active = imageGroup === c.name;
                return (
                  <button
                    key={c.name}
                    onClick={() => setImageGroup(c.name)}
                    className={`label flex items-center gap-2 border px-3 py-1.5 ${
                      active ? "border-ink bg-ink text-paper" : "border-line text-stone hover:text-ink"
                    }`}
                  >
                    <span className="h-3 w-3 border border-line" style={{ background: c.hex }} />
                    {c.name} ({count})
                  </button>
                );
              })}
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? "Uploading…" : "Upload images"}
              </Button>
              <Button variant="ghost" onClick={() => setPickerFor(true)}>
                Choose from library
              </Button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
            </div>
            <p className="mb-3 text-[12px] text-stone">
              Uploading to <strong>{imageGroup || "shared"}</strong>. Images are resized to ≤2000px and
              converted to WebP. The first image of a colour is its cover.
            </p>

            {groupImages.length === 0 ? (
              <div className="border border-dashed border-line p-8 text-center text-[13px] text-stone">
                {imageGroup
                  ? "No images for this colour — it falls back to shared images."
                  : "No shared images yet."}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {groupImages.map((img) => {
                  const index = form.images.indexOf(img);
                  return (
                    <div key={`${img.mediaId}-${index}`} className="border border-line bg-mist">
                      <div className="relative">
                        <img src={img.url} alt="" className="h-32 w-full object-cover" />
                        {index === form.images.findIndex((x) => (x.colorName || "") === imageGroup) && (
                          <span className="absolute left-1 top-1 bg-ink px-1.5 py-0.5 text-[10px] text-paper">
                            COVER
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 p-2">
                        <input
                          className="w-full border border-line bg-card px-1.5 py-1 text-[11px]"
                          placeholder="Alt text"
                          value={img.alt ?? ""}
                          onChange={(e) => {
                            const next = [...form.images];
                            next[index] = { ...img, alt: e.target.value };
                            update({ images: next });
                          }}
                        />
                        <select
                          className="w-full border border-line bg-card px-1 py-1 text-[11px]"
                          value={img.colorName || ""}
                          onChange={(e) => moveImageTo(index, e.target.value)}
                        >
                          <option value="">Move to shared</option>
                          {form.colors.map((c) => (
                            <option key={c.name} value={c.name}>
                              Move to {c.name}
                            </option>
                          ))}
                        </select>
                        <div className="flex items-center justify-between">
                          <div className="flex gap-1">
                            <button className="label text-stone hover:text-ink" onClick={() => moveImage(index, -1)}>
                              ←
                            </button>
                            <button className="label text-stone hover:text-ink" onClick={() => moveImage(index, 1)}>
                              →
                            </button>
                          </div>
                          <button className="label text-danger" onClick={() => removeImage(index)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {form.colors.some((c) => !form.images.some((i) => i.colorName === c.name)) && (
              <p className="mt-3 text-[12px] text-warn">
                Some colours have no images and will fall back to shared images.
              </p>
            )}
          </Card>
        </div>
      )}

      {tab === "Variants" && (
        <Card className="p-5">
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="label mb-2 text-graphite">Add colour</p>
              <ColorAdder onAdd={addColor} compact />
            </div>
            <div>
              <p className="label mb-2 text-graphite">Add size</p>
              <div className="flex flex-wrap gap-2">
                {presetSizes.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={sizes.includes(s) ? "ghost" : "outline"}
                    onClick={() => addSize(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = e.currentTarget.elements.customSize;
                  addSize(input.value);
                  input.value = "";
                }}
              >
                <TextInput name="customSize" placeholder="Custom size" className="!py-1.5" />
                <Button type="submit" size="sm" variant="outline">
                  Add
                </Button>
              </form>
            </div>
          </div>

          {sizes.length > 0 && (
            <div className="mb-4 flex flex-wrap items-end gap-2 border border-line bg-mist p-3">
              <Field label="Set price for size" className="!mb-0">
                <Select value={bulk.size} onChange={(e) => setBulk((b) => ({ ...b, size: e.target.value }))}>
                  <option value="">Choose size</option>
                  {sizes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <MoneyInput
                value={bulk.price}
                allowEmpty
                showFormatted={false}
                currency={currency.code}
                locale={currency.locale}
                onChange={(v) => setBulk((b) => ({ ...b, price: v }))}
                className="w-40"
              />
              <Button size="sm" variant="outline" onClick={applyBulkPrice} disabled={!bulk.size || bulk.price == null}>
                Apply to all colours
              </Button>
            </div>
          )}

          {form.variants.length === 0 ? (
            <p className="text-[13px] text-stone">
              No variants yet. Add a size — products without colours get size-only variants.
            </p>
          ) : (
            <div className="overflow-x-auto border border-line">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line">
                    {["Colour", "Size", `Price (${currency.code})`, "Compare-at", "Stock", "SKU", ""].map((h) => (
                      <th key={h} className="label px-3 py-2 text-stone">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {form.variants.map((v, i) => (
                    <tr key={`${v.colorName}-${v.size}-${i}`} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {v.colorName ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="h-3 w-3 border border-line" style={{ background: v.colorHex }} />
                            {v.colorName}
                          </span>
                        ) : (
                          <span className="text-stone">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{v.size}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          <MoneyInput
                            value={v.priceCents}
                            allowEmpty
                            currency={currency.code}
                            locale={currency.locale}
                            placeholder={money(form.price_cents)}
                            showFormatted={false}
                            className="w-36"
                            onChange={(value) => setVariant(i, { priceCents: value })}
                          />
                          {form.sizeType === "print" && (!v.priceCents || v.priceCents <= 0) && (
                            <span className="text-[11px] text-danger">Price required</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <MoneyInput
                          value={v.compareAtPriceCents}
                          allowEmpty
                          showFormatted={false}
                          currency={currency.code}
                          locale={currency.locale}
                          className="w-32"
                          onChange={(value) => setVariant(i, { compareAtPriceCents: value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <TextInput
                          type="number"
                          min="0"
                          className="!w-24 !py-1.5"
                          value={v.stock}
                          onChange={(e) => setVariant(i, { stock: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <TextInput
                          className="!w-40 !py-1.5 !text-[12px]"
                          value={v.sku ?? ""}
                          placeholder="auto"
                          onChange={(e) => setVariant(i, { sku: e.target.value })}
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

          <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-graphite">
            <span>
              Price range:{" "}
              {priceRange.to > priceRange.from
                ? `${money(priceRange.from)} – ${money(priceRange.to)}`
                : money(priceRange.from)}
            </span>
            <span>Total stock: {totalStock}</span>
            {sizes.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                Sizes:
                {sizes.map((s) => (
                  <button key={s} className="border border-line px-1.5 py-0.5 hover:border-ink" onClick={() => removeSize(s)}>
                    {s} ✕
                  </button>
                ))}
              </span>
            )}
          </div>
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

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card p-3 lg:hidden">
        <Button className="w-full" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
          Save
        </Button>
      </div>

      <MediaPicker open={pickerFor} onClose={() => setPickerFor(false)} onPick={pickMedia} />
    </div>
  );
}

/* ------------------------------------------------------ colour adder */
function ColorAdder({ onAdd, compact = false }) {
  const [name, setName] = useState("");
  const [hex, setHex] = useState("#000000");

  const submit = (e) => {
    e.preventDefault();
    onAdd(name, hex);
    setName("");
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <div className="flex gap-2">
        <TextInput placeholder="Colour name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          type="color"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          className="h-[42px] w-12 shrink-0 border border-line"
          aria-label="Colour hex"
        />
        <Button type="submit" variant="outline">
          Add
        </Button>
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-1">
          {PALETTE.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setHex(p)}
              aria-label={`Use ${p}`}
              className={`h-5 w-5 border ${hex.toLowerCase() === p.toLowerCase() ? "border-ink" : "border-line"}`}
              style={{ background: p }}
            />
          ))}
        </div>
      )}
    </form>
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
