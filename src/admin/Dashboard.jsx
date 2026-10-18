import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../lib/api";
import { formatDate, formatPrice } from "../lib/format";
import {
  Card,
  ErrorState,
  PageHeader,
  Spinner,
  StatCard,
  StatusDot,
} from "../components/ui";

const RANGES = ["7d", "30d", "90d"];

function Chart({ series }) {
  if (!series.length) return null;
  const max = Math.max(1, ...series.map((d) => d.revenue));
  const w = 720;
  const h = 160;
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const points = series.map((d, i) => `${i * step},${h - (d.revenue / max) * h}`);
  const path = `M${points.join(" L")}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[160px] w-full" preserveAspectRatio="none">
      <polyline points={points.join(" ")} fill="none" stroke="var(--color-ink)" strokeWidth="2" />
      <path d={`${path} L${w},${h} L0,${h} Z`} fill="var(--color-ink)" opacity="0.06" />
      {series.map((d, i) => (
        <rect
          key={d.day}
          x={i * step - 2}
          y={h - (d.revenue / max) * h - 2}
          width="4"
          height="4"
          fill="var(--color-ink)"
        >
          <title>{`${d.day}: ${formatPrice(d.revenue)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

export default function Dashboard() {
  const [range, setRange] = useState("30d");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", range],
    queryFn: () => api(`/admin/dashboard?range=${range}`).then((r) => r.data),
  });

  const pending = useQuery({
    queryKey: ["admin-pending-customers"],
    queryFn: () => api("/admin/customers?status=pending&limit=5"),
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });
  const pendingCount = pending.data?.meta?.counts?.pending ?? 0;
  const pendingRows = pending.data?.data ?? [];

  return (
    <div>
      <PageHeader title="Dashboard">
        <div className="flex border border-line">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`label px-4 py-2 ${
                range === r ? "bg-ink text-paper" : "bg-card text-stone hover:text-ink"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </PageHeader>

      {isLoading && <Spinner />}
      {error && <ErrorState error={error} onRetry={refetch} />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Link to="/admin/customers" className="block">
              <StatCard label="Pending accounts" value={pendingCount} sub="Awaiting approval" />
            </Link>
            <StatCard label="Revenue" value={formatPrice(data.stats.revenueCents)} sub="Paid + pending" />
            <StatCard label="Orders" value={data.stats.orders} />
            <StatCard label="Avg order" value={formatPrice(data.stats.averageOrderCents)} />
            <StatCard label="Conversion" value={`${(data.stats.conversion * 100).toFixed(1)}%`} sub="Orders ÷ views" />
            <StatCard label="New messages" value={data.stats.newMessages} />
            <StatCard label="Pending reviews" value={data.stats.pendingReviews} />
            <StatCard label="New subscribers" value={data.stats.newSubscribers} />
            <StatCard label="Product views" value={data.stats.productViews} />
          </div>

          <Card className="mt-4 p-5">
            <p className="label mb-4 text-stone">Revenue & orders — last {data.days} days</p>
            <Chart series={data.series} />
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <p className="label mb-4 text-stone">Funnel</p>
              {[
                ["Product views", data.funnel.productViews],
                ["Add to cart", data.funnel.addToCart],
                ["Checkout start", data.funnel.checkoutStart],
                ["Orders", data.funnel.orders],
              ].map(([label, value]) => {
                const max = Math.max(1, data.funnel.productViews);
                return (
                  <div key={label} className="mb-3">
                    <div className="flex justify-between text-[13px]">
                      <span className="text-graphite">{label}</span>
                      <span className="text-stone">{value}</span>
                    </div>
                    <div className="mt-1 h-2 bg-mist">
                      <div className="h-2 bg-ink" style={{ width: `${(value / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </Card>

            <Card className="p-5">
              <p className="label mb-4 text-stone">Top products</p>
              <div className="grid grid-cols-2 gap-4 text-[13px]">
                <div>
                  <p className="label mb-2 text-stone">By views</p>
                  {data.topByViews.length === 0 && <p className="text-stone">No data yet</p>}
                  {data.topByViews.map((p) => (
                    <div key={p.productId} className="flex justify-between border-b border-line py-1.5">
                      <span className="truncate pr-2 text-graphite">{p.name}</span>
                      <span className="text-stone">{p.views}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="label mb-2 text-stone">By units sold</p>
                  {data.topByUnits.length === 0 && <p className="text-stone">No data yet</p>}
                  {data.topByUnits.map((p) => (
                    <div key={p.productId} className="flex justify-between border-b border-line py-1.5">
                      <span className="truncate pr-2 text-graphite">{p.name}</span>
                      <span className="text-stone">{p.units}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5">
              <p className="label mb-3 text-stone">Pending accounts</p>
              {pendingRows.length === 0 && (
                <p className="text-[13px] text-stone">All caught up</p>
              )}
              {pendingRows.map((cust) => (
                <Link
                  key={cust.id}
                  to={`/admin/customers/${encodeURIComponent(cust.id)}`}
                  className="flex items-center justify-between border-b border-line py-2 text-[13px] hover:text-ink"
                >
                  <span className="truncate pr-2 text-graphite">
                    {[cust.firstName, cust.lastName].filter(Boolean).join(" ") ||
                      cust.email ||
                      cust.phone ||
                      "Unnamed"}
                  </span>
                  <span className="whitespace-nowrap text-stone">{formatDate(cust.createdAt)}</span>
                </Link>
              ))}
            </Card>

            <Card className="p-5">
              <p className="label mb-3 text-stone">Low stock</p>
              {data.needsAttention.lowStock.length === 0 && <p className="text-[13px] text-stone">All good</p>}
              {data.needsAttention.lowStock.map((v) => (
                <Link
                  key={v.variantId}
                  to={`/admin/products/${v.productId}`}
                  className="flex items-center justify-between border-b border-line py-2 text-[13px] hover:text-ink"
                >
                  <span className="truncate pr-2 text-graphite">
                    {v.productName} · {v.colorName} / {v.size}
                  </span>
                  <span className="flex items-center gap-2 text-danger">
                    <StatusDot tone={v.stock === 0 ? "danger" : "warn"} />
                    {v.stock}
                  </span>
                </Link>
              ))}
            </Card>

            <Card className="p-5">
              <p className="label mb-3 text-stone">Pending reviews</p>
              {data.needsAttention.pendingReviews.length === 0 && (
                <p className="text-[13px] text-stone">Nothing to moderate</p>
              )}
              {data.needsAttention.pendingReviews.map((r) => (
                <Link
                  key={r.id}
                  to="/admin/reviews"
                  className="flex items-center justify-between border-b border-line py-2 text-[13px] hover:text-ink"
                >
                  <span className="truncate pr-2 text-graphite">
                    {"★".repeat(r.rating)} · {r.author}
                  </span>
                  <span className="text-stone">{r.productName}</span>
                </Link>
              ))}
            </Card>

            <Card className="p-5">
              <p className="label mb-3 text-stone">Awaiting fulfillment</p>
              {data.needsAttention.awaitingFulfillment.length === 0 && (
                <p className="text-[13px] text-stone">All caught up</p>
              )}
              {data.needsAttention.awaitingFulfillment.map((o) => (
                <Link
                  key={o.id}
                  to={`/admin/orders/${o.id}`}
                  className="flex items-center justify-between border-b border-line py-2 text-[13px] hover:text-ink"
                >
                  <span className="text-graphite">{o.number}</span>
                  <span className="text-stone">{formatPrice(o.totalCents)}</span>
                </Link>
              ))}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
