import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api } from "../lib/api";
import { formatDate, formatDateTime, formatPrice } from "../lib/format";
import {
  Badge,
  Card,
  ErrorState,
  PageHeader,
  Spinner,
  StatCard,
  Table,
} from "../components/ui";

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-0">
      <span className="label text-stone">{label}</span>
      <span className="text-right text-[14px]">{children}</span>
    </div>
  );
}

export default function CustomerDetail() {
  const { id } = useParams();
  const customer = useQuery({
    queryKey: ["admin-customer", id],
    queryFn: () => api(`/admin/customers/${encodeURIComponent(id)}`).then((r) => r.data),
  });

  if (customer.isLoading) return <Spinner />;
  if (customer.error) return <ErrorState error={customer.error} onRetry={customer.refetch} />;
  if (!customer.data) return null;

  const c = customer.data;
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed customer";

  return (
    <div>
      <PageHeader title={name}>
        <Link to="/admin/customers" className="label text-stone hover:text-ink">
          ← All customers
        </Link>
      </PageHeader>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Orders" value={c.stats.orders} />
        <StatCard
          label="Lifetime spend"
          value={formatPrice(c.stats.spentCents, c.orders[0]?.currency ?? "EUR")}
        />
        <StatCard
          label="Last order"
          value={c.stats.lastOrderAt ? formatDate(c.stats.lastOrderAt) : "—"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div>
          <Card className="mb-4">
            <h2 className="label mb-2">Recent orders</h2>
            {c.orders.length === 0 ? (
              <p className="py-3 text-[14px] text-stone">
                No orders on this email address yet.
              </p>
            ) : (
              <Table head={["Order", "Status", "Total", "Date"]}>
                {c.orders.map((o) => (
                  <tr key={o.id} className="border-b border-line last:border-0 hover:bg-mist">
                    <td className="px-4 py-3">
                      <Link to={`/admin/orders/${o.id}`} className="font-medium hover:underline">
                        {o.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-graphite">{o.status.replace("_", " ")}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatPrice(o.totalCents, o.currency)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-stone">
                      {formatDate(o.createdAt)}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="label mb-2">Consent</h2>
            <div className="flex flex-wrap gap-2">
              <Badge tone={c.marketingOptIn ? "ok" : "stone"}>
                {c.marketingOptIn ? "Marketing email: on" : "Marketing email: off"}
              </Badge>
              <Badge tone={c.smsOptIn ? "ok" : "stone"}>
                {c.smsOptIn ? "SMS: on" : "SMS: off"}
              </Badge>
              {c.subscription && (
                <Badge tone={c.subscription.status === "active" ? "ok" : "stone"}>
                  Newsletter {c.subscription.status}
                </Badge>
              )}
            </div>
            <p className="mt-3 text-[13px] text-stone">
              Consent is stored with the account; Clerk holds the identity.
            </p>
          </Card>
        </div>

        <div>
          <Card className="p-5">
            <h2 className="label mb-2">Details</h2>
            <Row label="Status">
              {c.status === "deleted" ? <Badge tone="danger">deleted</Badge> : <Badge tone="stone">active</Badge>}
            </Row>
            <Row label="Email">{c.email || "—"}</Row>
            <Row label="Phone">{c.phone || "—"}</Row>
            <Row label="Clerk id">
              <span className="break-all text-[12px] text-stone">{c.id}</span>
            </Row>
            <Row label="Joined">{formatDate(c.createdAt)}</Row>
            <Row label="Last sign-in">{formatDateTime(c.lastSignInAt)}</Row>
            <Row label="Synced">{formatDateTime(c.updatedAt)}</Row>
            {c.deletedAt && <Row label="Deleted">{formatDateTime(c.deletedAt)}</Row>}
          </Card>
        </div>
      </div>
    </div>
  );
}
