import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
  TextInput,
  useToast,
} from "../components/ui";

const EMPTY_FORM = {
  id: "",
  title: "",
  unit: "inches",
  appliesToText: "",
  sizesText: "S, M, L, XL",
  measurements: [
    { name: "Chest", values: {} },
    { name: "Length", values: {} },
  ],
};

/** "S, M, L" -> ["S","M","L"] (trimmed, de-duplicated, order kept). */
function parseList(value) {
  const out = [];
  for (const raw of String(value ?? "").split(",")) {
    const item = raw.trim();
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

function chartToForm(chart) {
  const sizes = chart.sizes ?? [];
  return {
    id: chart.id,
    title: chart.title,
    unit: chart.unit ?? "inches",
    appliesToText: (chart.appliesTo ?? []).join(", "),
    sizesText: sizes.join(", "),
    measurements: Object.entries(chart.measurements ?? {}).map(([name, values]) => ({
      name,
      values: Object.fromEntries(sizes.map((size, i) => [size, String(values[i] ?? "")])),
    })),
  };
}

export default function SizeCharts() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const list = useQuery({
    queryKey: ["admin-size-charts"],
    queryFn: () => api("/admin/size-charts?limit=200").then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-size-charts"] });

  const save = useMutation({
    mutationFn: ({ original, body }) =>
      original
        ? api(`/admin/size-charts/${original}`, { method: "PUT", body })
        : api("/admin/size-charts", { method: "POST", body }),
    onSuccess: () => {
      toast.push("Size chart saved");
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/size-charts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.push("Size chart deleted");
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const rows = list.data ?? [];
  const sizes = editing ? parseList(editing.form.sizesText) : [];
  const canSave =
    !!editing &&
    !save.isPending &&
    editing.form.id.trim().length > 0 &&
    editing.form.title.trim().length > 0 &&
    sizes.length > 0;

  const patchForm = (patch) =>
    setEditing((s) => ({ ...s, form: { ...s.form, ...patch } }));

  const patchRow = (index, patch) =>
    setEditing((s) => ({
      ...s,
      form: {
        ...s.form,
        measurements: s.form.measurements.map((m, i) => (i === index ? { ...m, ...patch } : m)),
      },
    }));

  const patchValue = (index, size, value) =>
    setEditing((s) => ({
      ...s,
      form: {
        ...s.form,
        measurements: s.form.measurements.map((m, i) =>
          i === index ? { ...m, values: { ...m.values, [size]: value } } : m,
        ),
      },
    }));

  const addRow = () =>
    setEditing((s) => ({
      ...s,
      form: {
        ...s.form,
        measurements: [...s.form.measurements, { name: "", values: {} }],
      },
    }));

  const removeRow = (index) =>
    setEditing((s) => ({
      ...s,
      form: {
        ...s.form,
        measurements: s.form.measurements.filter((_, i) => i !== index),
      },
    }));

  const submit = (e) => {
    e.preventDefault();
    const f = editing.form;
    const chartSizes = parseList(f.sizesText);
    const measurements = {};
    for (const row of f.measurements) {
      const name = row.name.trim();
      if (!name) continue;
      measurements[name] = chartSizes.map((size) => row.values[size] ?? "");
    }
    save.mutate({
      original: editing.original,
      body: {
        id: f.id.trim(),
        title: f.title.trim(),
        unit: f.unit || "inches",
        appliesTo: parseList(f.appliesToText),
        sizes: chartSizes,
        measurements,
      },
    });
  };

  return (
    <div>
      <PageHeader title="Size charts">
        <Button onClick={() => setEditing({ original: null, form: { ...EMPTY_FORM } })}>
          + New chart
        </Button>
      </PageHeader>

      <p className="-mt-3 mb-4 max-w-2xl text-[13px] text-stone">
        Reusable measurement tables in inches (garment-side). Assign one to a product on the
        General tab of the product editor; the chart is then available on the product page.
      </p>

      {list.isLoading && <Spinner />}
      {list.data && rows.length === 0 && (
        <EmptyState
          title="No size charts yet"
          hint="Create a chart to make it selectable when uploading products."
        />
      )}

      {rows.length > 0 && (
        <Table head={["Chart", "Unit", "Sizes", "Measurements", "Applies to", ""]}>
          {rows.map((chart) => (
            <tr key={chart.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3">
                <p className="font-medium">{chart.title}</p>
                <p className="text-[12px] text-stone">{chart.id}</p>
              </td>
              <td className="px-4 py-3 text-stone">{chart.unit}</td>
              <td className="px-4 py-3">{(chart.sizes ?? []).join(" · ") || "—"}</td>
              <td className="px-4 py-3 text-stone">
                {Object.keys(chart.measurements ?? {}).join(", ") || "—"}
              </td>
              <td className="px-4 py-3 text-stone">
                {(chart.appliesTo ?? []).join(", ") || "—"}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing({ original: chart.id, form: chartToForm(chart) })}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="!text-danger"
                    onClick={() => setConfirm(chart)}
                  >
                    Del
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.original ? "Edit size chart" : "New size chart"}
        wide
      >
        {editing && (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Chart id" hint="Lowercase letters, numbers, - and _">
                <TextInput
                  value={editing.form.id}
                  disabled={!!editing.original}
                  placeholder="size-chart-tshirts"
                  onChange={(e) => patchForm({ id: e.target.value.toLowerCase() })}
                  required
                />
              </Field>
              <Field label="Title">
                <TextInput
                  value={editing.form.title}
                  placeholder="Standard T-Shirts"
                  onChange={(e) => patchForm({ title: e.target.value })}
                  required
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Unit">
                <Select value={editing.form.unit} onChange={(e) => patchForm({ unit: e.target.value })}>
                  <option value="inches">inches</option>
                  <option value="cm">cm</option>
                </Select>
              </Field>
              <Field label="Applies to" hint="Optional category slugs, comma-separated">
                <TextInput
                  value={editing.form.appliesToText}
                  placeholder="t-shirts, hoodies"
                  onChange={(e) => patchForm({ appliesToText: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Sizes" hint="Comma-separated, in display order">
              <TextInput
                value={editing.form.sizesText}
                placeholder="XS, S, M, L, XL"
                onChange={(e) => patchForm({ sizesText: e.target.value })}
                required
              />
            </Field>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="label text-graphite">Measurements</span>
                <Button type="button" size="sm" variant="ghost" onClick={addRow}>
                  + Add measurement
                </Button>
              </div>

              {sizes.length === 0 ? (
                <Card className="p-4 text-[13px] text-stone">
                  Add at least one size above to fill in measurements.
                </Card>
              ) : (
                <div className="overflow-x-auto border border-line">
                  <table className="w-full min-w-[520px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-line bg-mist">
                        <th className="label px-3 py-2 text-stone">Measurement</th>
                        {sizes.map((size, i) => (
                          <th key={`${size}-${i}`} className="label px-3 py-2 text-stone">
                            {size}
                          </th>
                        ))}
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {editing.form.measurements.map((row, index) => (
                        <tr key={index} className="border-b border-line last:border-0">
                          <td className="px-3 py-2">
                            <TextInput
                              value={row.name}
                              placeholder="Chest"
                              onChange={(e) => patchRow(index, { name: e.target.value })}
                            />
                          </td>
                          {sizes.map((size, i) => (
                            <td key={`${size}-${i}`} className="px-3 py-2">
                              <TextInput
                                value={row.values[size] ?? ""}
                                placeholder="34"
                                inputMode="decimal"
                                onChange={(e) => patchValue(index, size, e.target.value)}
                              />
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="!text-danger"
                              onClick={() => removeRow(index)}
                            >
                              ✕
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSave}>
                Save chart
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title="Delete size chart"
        message={`Delete "${confirm?.title}"? Products using it must be reassigned first.`}
        confirmLabel="Delete"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          remove.mutate(confirm.id);
          setConfirm(null);
        }}
      />
    </div>
  );
}
