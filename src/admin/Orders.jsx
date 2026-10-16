import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../lib/api";
import { formatPrice, formatDate } from "../lib/format";
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatusDot,
  Table,
  TextInput,
} from "../components/ui";

const STATUSES = ["", "pending", "paid", "in_production", "shipped", "delivered", "cancelled", "refunded"];
const TONES = {
  pending: "warn",
  paid: "ok",
  in_production: "warn",
  shipped: "ok",
  delivered: "ok",
  cancelled: "danger",
  refunded: "graphite",
};

export default function Orders() {
  const [filters, setFilters] = useState({ status: "", q: "", page: 1 });
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v !== ""),
  ).toString();

  const list = useQuery({
    queryKey: ["admin-orders", filters],
    queryFn: () => api(`/admin/orders?${params}`).then((r) => r),
  });

  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;

  return (
    <div>
      <PageHeader title="Orders">
        <a
          href="/api/admin/orders/export.csv"
          className="label inline-flex items-center border border-line bg-card px-4 py-2.5 hover:border-ink"
        >
          Export CSV
        </a>
      </PageHeader>

      <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <Field label="Search">
          <TextInput
            placeholder="Number or email"
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value, page: 1 }))}
          />
        </Field>
        <Field label="Status">
          <Select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s.replace("_", " ") : "All statuses"}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {list.isLoading && <Spinner />}
      {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && rows.length === 0 && <EmptyState title="No orders" hint="Orders will appear here." />}

      {rows.length > 0 && (
        <>
          <Table head={["Order", "Customer", "Status", "Items", "Total", "Date"]}>
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-line last:border-0 hover:bg-mist">
                <td className="px-4 py-3">
                  <Link to={`/admin/orders/${o.id}`} className="font-medium hover:underline">
                    {o.number}
                  </Link>
                </td>
                <td className="px-4 py-3 text-graphite">{o.email}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2 text-[13px]">
                    <StatusDot tone={TONES[o.status] ?? "graphite"} />
                    {o.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3">{o.itemCount}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatPrice(o.totalCents, o.currency)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-stone">{formatDate(o.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <Pagination
            page={meta.page}
            pages={meta.pages}
            onChange={(page) => setFilters((f) => ({ ...f, page }))}
          />
        </>
      )}
    </div>
  );
}
