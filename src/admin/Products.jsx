import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { api } from "../lib/api";
import { formatPrice, formatDate } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Table,
  TextInput,
  useToast,
} from "../components/ui";

const STATUS = ["", "draft", "published", "archived"];
const STOCK = ["", "low", "out"];

function statusTone(status) {
  if (status === "published") return "solid";
  if (status === "draft") return "outline";
  return "stone";
}

export default function Products() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  const [filters, setFilters] = useState({ q: "", status: "", category: "", stock: "", page: 1 });
  const [selected, setSelected] = useState([]);
  const [confirm, setConfirm] = useState(null);

  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v !== "" && v != null),
  ).toString();

  const list = useQuery({
    queryKey: ["admin-products", filters],
    queryFn: () => api(`/admin/products?${params}`).then((r) => r),
  });

  const categories = useQuery({
    queryKey: ["admin-categories"],
    queryFn: () => api("/admin/categories").then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-products"] });
    setSelected([]);
  };

  const bulk = useMutation({
    mutationFn: (action) => api("/admin/products/bulk", { method: "POST", body: { ids: selected, action } }),
    onSuccess: () => {
      toast.push("Products updated");
      invalidate();
    },
  });

  const duplicate = useMutation({
    mutationFn: (id) => api(`/admin/products/${id}/duplicate`, { method: "POST" }),
    onSuccess: () => {
      toast.push("Product duplicated");
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/products/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.push("Product removed");
      invalidate();
    },
  });

  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value, page: 1 }));
  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;
  const allChecked = rows.length > 0 && selected.length === rows.length;

  const toggleAll = () =>
    setSelected(allChecked ? [] : rows.map((r) => r.id));
  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div>
      <PageHeader title="Products">
        <Button onClick={() => navigate("/admin/products/new")}>+ New product</Button>
      </PageHeader>

      <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search">
          <TextInput
            placeholder="Name or slug"
            defaultValue={filters.q}
            onChange={(e) => set("q", e.target.value)}
          />
        </Field>
        <Field label="Status">
          <Select value={filters.status} onChange={(e) => set("status", e.target.value)}>
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {s || "All statuses"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category">
          <Select value={filters.category} onChange={(e) => set("category", e.target.value)}>
            <option value="">All categories</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Stock">
          <Select value={filters.stock} onChange={(e) => set("stock", e.target.value)}>
            {STOCK.map((s) => (
              <option key={s} value={s}>
                {s === "low" ? "Low (≤3)" : s === "out" ? "Out of stock" : "Any stock"}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {selected.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 border border-ink bg-card p-3">
          <span className="label text-graphite">{selected.length} selected</span>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate("publish")}>
            Publish
          </Button>
          <Button size="sm" variant="ghost" onClick={() => bulk.mutate("draft")}>
            Draft
          </Button>
          <Button size="sm" variant="ghost" onClick={() => bulk.mutate("archive")}>
            Archive
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}

      {list.isLoading && <Spinner />}
      {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}

      {list.data && rows.length === 0 && (
        <EmptyState
          title="No products"
          hint="Try clearing filters, or add your first product."
          action={<Button onClick={() => navigate("/admin/products/new")}>+ New product</Button>}
        />
      )}

      {rows.length > 0 && (
        <>
          <Table head={["", "Product", "Status", "Price", "Stock", "Updated", ""]}>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ink"
                    checked={selected.includes(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 shrink-0 border border-line bg-mist">
                      {p.image && (
                        <img src={p.image.url} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <Link to={`/admin/products/${p.id}`} className="block truncate font-medium hover:underline">
                        {p.name}
                      </Link>
                      <span className="text-[12px] text-stone">{p.slug}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{formatPrice(p.price_cents)}</td>
                <td className="px-4 py-3">
                  <span className={p.stockTotal === 0 ? "text-danger" : ""}>{p.stockTotal}</span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-stone">{formatDate(p.updatedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/admin/products/${p.id}`)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => duplicate.mutate(p.id)}>
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="!text-danger"
                      onClick={() => setConfirm(p)}
                    >
                      Del
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>

          <div className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-ink"
              checked={allChecked}
              onChange={toggleAll}
            />
            <span className="text-[12px] text-stone">Select all on page</span>
          </div>

          <Pagination
            page={meta.page}
            pages={meta.pages}
            onChange={(page) => setFilters((f) => ({ ...f, page }))}
          />
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        title="Delete product"
        message={`Delete “${confirm?.name}”? If it has orders it will be archived instead.`}
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
