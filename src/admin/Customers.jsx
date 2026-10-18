import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Table,
  TextInput,
} from "../components/ui";

const STATUSES = ["", "active", "deleted"];

function displayName(c) {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return name || c.email || "Unnamed";
}

export default function Customers() {
  const [filters, setFilters] = useState({ status: "", q: "", page: 1 });
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v !== ""),
  ).toString();

  const list = useQuery({
    queryKey: ["admin-customers", filters],
    queryFn: () => api(`/admin/customers?${params}`).then((r) => r),
  });

  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;

  return (
    <div>
      <PageHeader title="Customers" />

      <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <Field label="Search">
          <TextInput
            placeholder="Name, email or Clerk id"
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
                {s || "All statuses"}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {list.isLoading && <Spinner />}
      {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && rows.length === 0 && (
        <EmptyState
          title="No customers yet"
          hint="Accounts created through Clerk sign-up appear here automatically."
        />
      )}

      {rows.length > 0 && (
        <>
          <Table head={["Customer", "Email", "Phone", "Consent", "Status", "Joined"]}>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0 hover:bg-mist">
                <td className="px-4 py-3">
                  <Link
                    to={`/admin/customers/${encodeURIComponent(c.id)}`}
                    className="font-medium hover:underline"
                  >
                    {displayName(c)}
                  </Link>
                  <p className="mt-0.5 text-[12px] text-stone">{c.id}</p>
                </td>
                <td className="px-4 py-3 text-graphite">{c.email || "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap text-graphite">{c.phone || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {c.marketingOptIn && <Badge tone="ok">Email</Badge>}
                    {c.smsOptIn && <Badge tone="ok">SMS</Badge>}
                    {!c.marketingOptIn && !c.smsOptIn && <span className="text-stone">—</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {c.status === "deleted" ? (
                    <Badge tone="danger">deleted</Badge>
                  ) : (
                    <Badge tone="stone">active</Badge>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-stone">{formatDate(c.createdAt)}</td>
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
