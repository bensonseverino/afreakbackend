import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  PageHeader,
  Spinner,
  Table,
  TextInput,
  useToast,
} from "../components/ui";

export default function Categories() {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState({ name: "" });
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const list = useQuery({
    queryKey: ["admin-categories"],
    queryFn: () => api("/admin/categories").then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-categories"] });

  const create = useMutation({
    mutationFn: (body) => api("/admin/categories", { method: "POST", body }),
    onSuccess: () => {
      toast.push("Category created");
      setDraft({ name: "" });
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const update = useMutation({
    mutationFn: ({ id, body }) => api(`/admin/categories/${id}`, { method: "PUT", body }),
    onSuccess: () => {
      toast.push("Category saved");
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.push("Category deleted");
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const reorder = useMutation({
    mutationFn: (ids) => api("/admin/categories/reorder", { method: "POST", body: { ids } }),
    onSuccess: invalidate,
  });

  const rows = list.data ?? [];
  const move = (index, delta) => {
    const ids = rows.map((r) => r.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <div>
      <PageHeader title="Categories" />

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label="New category" className="min-w-[220px] flex-1">
          <TextInput
            value={draft.name}
            onChange={(e) => setDraft({ name: e.target.value })}
            placeholder="e.g. Outerwear"
          />
        </Field>
        <Button onClick={() => create.mutate({ name: draft.name })} disabled={!draft.name}>
          Add category
        </Button>
      </Card>

      {list.isLoading && <Spinner />}

      {rows.length > 0 && (
        <Table head={["Order", "Name", "Slug", "Products", ""]}>
          {rows.map((c, i) => (
            <tr key={c.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  <button className="label text-stone hover:text-ink" onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button className="label text-stone hover:text-ink" onClick={() => move(i, 1)}>
                    ↓
                  </button>
                </div>
              </td>
              <td className="px-4 py-3">
                {editing === c.id ? (
                  <TextInput
                    autoFocus
                    defaultValue={c.name}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        update.mutate({ id: c.id, body: { name: e.target.value, slug: c.slug, sort: c.sort } });
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  c.name
                )}
              </td>
              <td className="px-4 py-3 text-stone">{c.slug}</td>
              <td className="px-4 py-3">{c.productCount}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                    {editing === c.id ? "Editing…" : "Rename"}
                  </Button>
                  <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setConfirm(c)}>
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <ConfirmDialog
        open={!!confirm}
        title="Delete category"
        message={`Delete “${confirm?.name}”? Categories with products cannot be deleted.`}
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
