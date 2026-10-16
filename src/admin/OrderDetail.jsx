import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api } from "../lib/api";
import { formatPrice, formatDateTime } from "../lib/format";
import {
  Button,
  Card,
  Field,
  PageHeader,
  Select,
  Spinner,
  StatusDot,
  TextArea,
  TextInput,
  useToast,
} from "../components/ui";

const STATUSES = ["pending", "paid", "in_production", "shipped", "delivered", "cancelled", "refunded"];
const PAYMENTS = ["unpaid", "paid", "refunded"];

export default function OrderDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ status: "", trackingNumber: "", notes: "" });

  const order = useQuery({
    queryKey: ["admin-order", id],
    queryFn: () => api(`/admin/orders/${id}`).then((r) => r.data),
  });

  useEffect(() => {
    if (order.data) {
      setForm({
        status: order.data.status,
        trackingNumber: order.data.trackingNumber ?? "",
        notes: order.data.notes ?? "",
      });
    }
  }, [order.data]);

  const save = useMutation({
    mutationFn: (body) => api(`/admin/orders/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      toast.push("Order updated");
      qc.invalidateQueries({ queryKey: ["admin-order", id] });
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  if (order.isLoading) return <Spinner />;
  if (!order.data) return null;
  const o = order.data;

  return (
    <div>
      <PageHeader title={`Order ${o.number}`}>
        <Link to="/admin/orders" className="label text-stone hover:text-ink">
          ← All orders
        </Link>
        <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
          Save changes
        </Button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div>
          <Card className="mb-4">
            <div className="border-b border-line px-5 py-3">
              <p className="label text-stone">Items</p>
            </div>
            {o.items.map((it) => (
              <div key={it.id} className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 last:border-0">
                <div>
                  <p className="text-[14px] text-graphite">{it.name}</p>
                  <p className="text-[12px] text-stone">
                    {it.colorName} · {it.size} · ×{it.qty}
                  </p>
                  {it.print && (
                    <div className="mt-2 border border-line bg-mist p-2 text-[12px]">
                      <p className="label text-stone">Custom print</p>
                      <p className="text-graphite">Placement: {it.print.placement || "—"}</p>
                      {it.print.artworkKey && (
                        <a
                          className="label mt-1 inline-block text-ink underline"
                          href={`/api/admin/artwork/${String(it.print.artworkKey).replace(/^artwork\//, "")}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download artwork
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <span className="whitespace-nowrap text-[13px]">
                  {formatPrice(it.unitPriceCents * it.qty, o.currency)}
                </span>
              </div>
            ))}
          </Card>

          <Card className="p-5">
            <p className="label mb-3 text-stone">Totals</p>
            {[
              ["Subtotal", o.subtotalCents],
              ["Discount", -o.discountCents],
              ["Shipping", o.shippingCents],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between border-b border-line py-2 text-[13px]">
                <span className="text-graphite">{label}</span>
                <span>{formatPrice(value, o.currency)}</span>
              </div>
            ))}
            <div className="flex justify-between py-3 font-medium">
              <span>Total</span>
              <span>{formatPrice(o.totalCents, o.currency)}</span>
            </div>
            {o.promoCode && <p className="text-[12px] text-stone">Promo: {o.promoCode}</p>}
          </Card>
        </div>

        <div>
          <Card className="mb-4 p-5">
            <p className="label mb-3 text-stone">Manage</p>
            <Field label="Status" className="mb-3">
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tracking number" className="mb-3">
              <TextInput
                value={form.trackingNumber}
                onChange={(e) => setForm((f) => ({ ...f, trackingNumber: e.target.value }))}
              />
            </Field>
            <Field label="Internal notes">
              <TextArea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>
            <div className="mt-3 flex items-center gap-2 text-[12px] text-stone">
              <StatusDot tone={o.paymentStatus === "paid" ? "ok" : "warn"} />
              Payment: {o.paymentStatus}
              <button
                className="label text-ink underline"
                onClick={() => save.mutate({ paymentStatus: o.paymentStatus === "paid" ? "unpaid" : "paid" })}
              >
                Toggle
              </button>
            </div>
          </Card>

          <Card className="p-5">
            <p className="label mb-3 text-stone">Customer</p>
            <p className="text-[13px] text-graphite">{o.email}</p>
            {o.phone && <p className="text-[13px] text-stone">{o.phone}</p>}
            <div className="mt-3 text-[13px] text-graphite">
              <p>{o.address?.line1}</p>
              {o.address?.line2 && <p>{o.address.line2}</p>}
              <p>
                {o.address?.postalCode} {o.address?.city}
              </p>
              <p>{o.address?.country}</p>
            </div>
            <p className="mt-3 text-[12px] text-stone">Placed {formatDateTime(o.createdAt)}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
