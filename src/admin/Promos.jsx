import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { centsToInput, parsePriceToCents } from "../lib/format";
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
  Table,
  TextInput,
  useToast,
} from "../components/ui";

const EMPTY = {
  code: "",
  type: "percent",
  value: 10,
  minSubtotalCents: 0,
  active: true,
  expiresAt: "",
  maxUses: "",
};

export default function Promos() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const list = useQuery({
    queryKey: ["admin-promos"],
    queryFn: () => api("/admin/promos").then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-promos"] });

  const save = useMutation({
    mutationFn: ({ original, body }) =>
      original
        ? api(`/admin/promos/${original}`, { method: "PUT", body })
        : api("/admin/promos", { method: "POST", body }),
    onSuccess: () => {
      toast.push("Promo saved");
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const remove = useMutation({
    mutationFn: (code) => api(`/admin/promos/${code}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.push("Promo deleted");
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const rows = list.data ?? [];

  const submit = (e) => {
    e.preventDefault();
    const f = editing.form;
    save.mutate({
      original: editing.original,
      body: {
        code: f.code,
        type: f.type,
        value: f.type === "percent" ? Number(f.value) : parsePriceToCents(f.value),
        minSubtotalCents: parsePriceToCents(f.minSubtotalCents),
        active: f.active,
        expiresAt: f.expiresAt || null,
        maxUses: f.maxUses ? Number(f.maxUses) : null,
      },
    });
  };

  return (
    <div>
      <PageHeader title="Promo codes">
        <Button onClick={() => setEditing({ original: null, form: { ...EMPTY } })}>+ New code</Button>
      </PageHeader>

      {list.isLoading && <Spinner />}
      {list.data && rows.length === 0 && <EmptyState title="No promo codes" />}

      {rows.length > 0 && (
        <Table head={["Code", "Discount", "Min order", "Uses", "Expires", "Status", ""]}>
          {rows.map((p) => (
            <tr key={p.code} className="border-b border-line last:border-0">
              <td className="px-4 py-3 font-medium">{p.code}</td>
              <td className="px-4 py-3">
                {p.type === "percent" ? `${p.value}%` : `${(p.value / 100).toFixed(2)} €`}
              </td>
              <td className="px-4 py-3">{(p.minSubtotalCents / 100).toFixed(2)} €</td>
              <td className="px-4 py-3">
                {p.uses}
                {p.maxUses ? ` / ${p.maxUses}` : ""}
              </td>
              <td className="px-4 py-3 text-stone">{p.expiresAt || "—"}</td>
              <td className="px-4 py-3">
                <Badge tone={p.active ? "ok" : "stone"}>{p.active ? "active" : "inactive"}</Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditing({
                        original: p.code,
                        form: {
                          code: p.code,
                          type: p.type,
                          value: p.type === "percent" ? p.value : centsToInput(p.value),
                          minSubtotalCents: centsToInput(p.minSubtotalCents),
                          active: p.active,
                          expiresAt: p.expiresAt || "",
                          maxUses: p.maxUses ?? "",
                        },
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setConfirm(p)}>
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
        title={editing?.original ? "Edit promo" : "New promo"}
      >
        {editing && (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Code">
              <TextInput
                value={editing.form.code}
                disabled={!!editing.original}
                onChange={(e) =>
                  setEditing((s) => ({ ...s, form: { ...s.form, code: e.target.value.toUpperCase() } }))
                }
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select
                  value={editing.form.type}
                  onChange={(e) => setEditing((s) => ({ ...s, form: { ...s.form, type: e.target.value } }))}
                >
                  <option value="percent">Percent</option>
                  <option value="fixed">Fixed amount</option>
                </Select>
              </Field>
              <Field label={editing.form.type === "percent" ? "Percent off" : "Amount (EUR)"}>
                <TextInput
                  value={editing.form.value}
                  onChange={(e) => setEditing((s) => ({ ...s, form: { ...s.form, value: e.target.value } }))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min order (EUR)">
                <TextInput
                  value={editing.form.minSubtotalCents}
                  onChange={(e) =>
                    setEditing((s) => ({ ...s, form: { ...s.form, minSubtotalCents: e.target.value } }))
                  }
                />
              </Field>
              <Field label="Max uses" hint="Blank = unlimited">
                <TextInput
                  value={editing.form.maxUses}
                  onChange={(e) => setEditing((s) => ({ ...s, form: { ...s.form, maxUses: e.target.value } }))}
                />
              </Field>
            </div>
            <Field label="Expires at" hint="ISO date, e.g. 2026-12-31T23:59:00Z">
              <TextInput
                value={editing.form.expiresAt}
                onChange={(e) => setEditing((s) => ({ ...s, form: { ...s.form, expiresAt: e.target.value } }))}
              />
            </Field>
            <Checkbox
              label="Active"
              checked={editing.form.active}
              onChange={(e) => setEditing((s) => ({ ...s, form: { ...s.form, active: e.target.checked } }))}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                Save
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title="Delete promo"
        message={`Delete code ${confirm?.code}?`}
        confirmLabel="Delete"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          remove.mutate(confirm.code);
          setConfirm(null);
        }}
      />
    </div>
  );
}
