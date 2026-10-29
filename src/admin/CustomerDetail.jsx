import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../lib/api";
import { formatDate, formatDateTime, formatPrice } from "../lib/format";
import { useMe } from "../hooks/useAuth";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Spinner,
  StatCard,
  StatusDot,
  TextArea,
  useToast,
} from "../components/ui";
import {
  ApproveDialog,
  DeleteCustomerDialog,
  EditCustomerDialog,
  RejectDialog,
  ResetPasswordDialog,
  StatusBadge,
} from "./customerWidgets";
import { SOURCE_LABEL, displayName, primaryContact, relativeTime } from "./customerUtils";

const STATUS_ACTIONS = new Set(["signup", "create", "approve", "reject", "suspend", "unsuspend", "delete"]);

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-0">
      <span className="label text-stone">{label}</span>
      <span className="text-right text-[14px]">{children}</span>
    </div>
  );
}

function CardSection({ title, action, children }) {
  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="label text-stone">{title}</p>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

export default function CustomerDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const me = useMe();
  const isOwner = me.data?.role === "owner";

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(null);

  const customer = useQuery({
    queryKey: ["admin-customer", id],
    queryFn: () => api(`/admin/customers/${encodeURIComponent(id)}`).then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-customer", id] });
    qc.invalidateQueries({ queryKey: ["admin-customers"] });
    qc.invalidateQueries({ queryKey: ["admin-customer-counts"] });
    qc.invalidateQueries({ queryKey: ["admin-password-requests"] });
  };

  const act = useMutation({
    mutationFn: ({ path }) =>
      api(`/admin/customers/${encodeURIComponent(id)}/${path}`, { method: "POST" }),
    onSuccess: (_data, vars) => {
      toast.push(vars.message);
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const saveNotes = useMutation({
    mutationFn: (adminNotes) =>
      api(`/admin/customers/${encodeURIComponent(id)}`, { method: "PATCH", body: { adminNotes } }),
    onSuccess: () => {
      toast.push("Notes saved");
      setNotesDraft(null);
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const linkOrders = useMutation({
    mutationFn: () =>
      api(`/admin/customers/${encodeURIComponent(id)}/link-orders`, { method: "POST" }).then(
        (r) => r.data,
      ),
    onSuccess: (data) => {
      toast.push(`${data.linked} order${data.linked === 1 ? "" : "s"} linked`);
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  if (customer.isLoading) return <Spinner />;
  if (customer.error) return <ErrorState error={customer.error} onRetry={customer.refetch} />;
  if (!customer.data) return null;

  const c = customer.data;
  const name = displayName(c);
  const canApprove = c.status === "pending" || c.status === "rejected";
  const timeline = (c.audit ?? []).filter((entry) => STATUS_ACTIONS.has(entry.action)).slice(0, 6);

  return (
    <div>
      <Link to="/admin/customers" className="label text-stone hover:text-ink">
        ← All customers
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[26px] font-extrabold uppercase tracking-tight">{name}</h1>
        <StatusBadge status={c.status} />
      </div>
      <p className="mt-2 text-[13px] text-stone">
        Signed up {formatDate(c.createdAt)} · {SOURCE_LABEL[c.signupSource] ?? c.signupSource}
      </p>

      <div className="mt-4 mb-6 flex flex-wrap gap-2">
        {canApprove && (
          <Button className="min-h-12" onClick={() => setApproveOpen(true)}>
            APPROVE
          </Button>
        )}
        {canApprove && (
          <Button variant="outline" className="min-h-12" onClick={() => setRejectOpen(true)}>
            REJECT
          </Button>
        )}
        {c.status === "active" && (
          <Button
            variant="outline"
            className="min-h-12"
            disabled={act.isPending}
            onClick={() => act.mutate({ path: "suspend", message: "Account suspended" })}
          >
            SUSPEND
          </Button>
        )}
        {c.status === "suspended" && (
          <Button
            variant="outline"
            className="min-h-12"
            disabled={act.isPending}
            onClick={() => act.mutate({ path: "unsuspend", message: "Account unsuspended" })}
          >
            UNSUSPEND
          </Button>
        )}
        <Button variant="outline" className="min-h-12" onClick={() => setResetOpen(true)}>
          RESET PASSWORD
        </Button>
        <Button variant="outline" className="min-h-12" onClick={() => setEditOpen(true)}>
          EDIT
        </Button>
        {isOwner && (
          <Button
            variant="outline"
            className="min-h-12 !border-danger !text-danger"
            onClick={() => setDeleteOpen(true)}
          >
            DELETE
          </Button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Orders" value={c.stats.orders} />
        <StatCard label="Lifetime spend" value={formatPrice(c.stats.spentCents)} />
        <StatCard
          label="Last order"
          value={c.stats.lastOrderAt ? formatDate(c.stats.lastOrderAt) : "—"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div>
          <CardSection
            title="Orders"
            action={
              <Button
                size="sm"
                variant="outline"
                disabled={linkOrders.isPending || c.guestOrderMatches === 0}
                onClick={() => linkOrders.mutate()}
              >
                LINK GUEST ORDERS ({c.guestOrderMatches})
              </Button>
            }
          >
            {c.orders.length === 0 ? (
              <p className="text-[14px] text-stone">No orders on this account yet.</p>
            ) : (
              <div>
                {c.orders.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0"
                  >
                    <Link to={`/admin/orders/${o.id}`} className="text-[14px] hover:underline">
                      {o.number}
                    </Link>
                    <span className="text-[12px] text-stone">{o.status.replace("_", " ")}</span>
                    <span className="ml-auto whitespace-nowrap text-[13px]">
                      {formatPrice(o.totalCents, o.currency)}
                    </span>
                    <span className="whitespace-nowrap text-[12px] text-stone">
                      {formatDate(o.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {c.guestOrderMatches > 0 && (
              <p className="mt-3 text-[12px] text-graphite">
                {c.guestOrderMatches} unlinked guest order
                {c.guestOrderMatches === 1 ? "" : "s"} carry this email or phone.
              </p>
            )}
          </CardSection>

          <CardSection title="Addresses">
            {c.addresses.length === 0 ? (
              <p className="text-[14px] text-stone">No saved addresses.</p>
            ) : (
              <div className="space-y-3">
                {c.addresses.map((a) => (
                  <div key={a.id} className="border border-line p-3 text-[13px] text-graphite">
                    <p>
                      {a.line1}
                      {a.line2 ? `, ${a.line2}` : ""}
                    </p>
                    <p>
                      {a.postalCode} {a.city}
                    </p>
                    <p>{a.country}</p>
                  </div>
                ))}
              </div>
            )}
          </CardSection>

          <CardSection title="Returns">
            {c.returns.length === 0 ? (
              <p className="text-[14px] text-stone">No return requests.</p>
            ) : (
              <div className="space-y-3">
                {c.returns.map((r) => (
                  <div key={r.id} className="border border-line p-3 text-[13px] text-graphite">
                    <p>{r.orderNumber ?? r.id}</p>
                    <p className="text-stone">{r.status}</p>
                  </div>
                ))}
              </div>
            )}
          </CardSection>

          <CardSection title="Audit log">
            {(c.audit ?? []).length === 0 ? (
              <p className="text-[14px] text-stone">Nothing logged yet.</p>
            ) : (
              <div>
                {c.audit.slice(0, 50).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2.5 last:border-0"
                  >
                    <span className="label text-graphite">
                      {entry.action.replace(/_/g, " ")}
                    </span>
                    <span className="text-[12px] text-stone">{entry.adminEmail || "system"}</span>
                    <span className="ml-auto text-[12px] text-stone" title={formatDateTime(entry.createdAt)}>
                      {relativeTime(entry.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardSection>
        </div>

        <div>
          <CardSection title="Profile">
            <Row label="Name">{name}</Row>
            <Row label="Email">{c.email || "—"}</Row>
            <Row label="Phone">{c.phone || "—"}</Row>
            <Row label="Marketing">
              <Badge tone={c.marketingOptIn ? "ok" : "stone"}>
                {c.marketingOptIn ? "Opted in" : "Opted out"}
              </Badge>
            </Row>

            <p className="label mt-4 mb-2 text-stone">Admin notes</p>
            {notesDraft === null ? (
              <>
                <p className="whitespace-pre-wrap text-[14px] text-graphite">
                  {c.adminNotes || "No notes yet."}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-3"
                  onClick={() => setNotesDraft(c.adminNotes ?? "")}
                >
                  EDIT NOTES
                </Button>
              </>
            ) : (
              <>
                <TextArea
                  rows={4}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                />
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setNotesDraft(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={saveNotes.isPending}
                    onClick={() => saveNotes.mutate(notesDraft)}
                  >
                    SAVE NOTES
                  </Button>
                </div>
              </>
            )}
          </CardSection>

          <CardSection title="Account">
            {c.openResetRequest && (
              <div className="mb-4 border border-warn p-3">
                <p className="text-[13px] text-warn">
                  Password reset requested {relativeTime(c.openResetRequest.createdAt)}.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 !border-warn !text-warn"
                  onClick={() => setResetOpen(true)}
                >
                  RESET NOW
                </Button>
              </div>
            )}

            <Row label="Status">
              <StatusBadge status={c.status} />
            </Row>
            <Row label="Last sign-in">{formatDateTime(c.lastLoginAt)}</Row>
            <Row label="Sessions">{c.sessionsCount}</Row>
            <Row label="Must change password">
              {c.mustChangePassword ? (
                <Badge tone="warn">Yes</Badge>
              ) : (
                <Badge tone="stone">No</Badge>
              )}
            </Row>
            {c.subscription && (
              <Row label="Newsletter">
                <Badge tone={c.subscription.status === "active" ? "ok" : "stone"}>
                  {c.subscription.status}
                </Badge>
              </Row>
            )}

            <p className="label mt-4 mb-2 text-stone">Status timeline</p>
            {timeline.length === 0 ? (
              <p className="text-[13px] text-stone">No status changes recorded.</p>
            ) : (
              timeline.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                  <StatusDot tone="graphite" />
                  <span className="text-graphite capitalize">{entry.action.replace(/_/g, " ")}</span>
                  <span className="ml-auto text-[12px] text-stone">{relativeTime(entry.createdAt)}</span>
                </div>
              ))
            )}
          </CardSection>

          <CardSection title="Contact">
            <p className="text-[14px] text-graphite">{primaryContact(c)}</p>
            <p className="mt-2 break-all text-[12px] text-stone">ID {c.id}</p>
          </CardSection>
        </div>
      </div>

      {approveOpen && (
        <ApproveDialog
          customer={c}
          onClose={() => setApproveOpen(false)}
          onSuccess={invalidate}
        />
      )}
      {rejectOpen && (
        <RejectDialog customer={c} onClose={() => setRejectOpen(false)} onSuccess={invalidate} />
      )}
      {resetOpen && (
        <ResetPasswordDialog
          customer={c}
          onClose={() => setResetOpen(false)}
          onSuccess={invalidate}
        />
      )}
      {editOpen && (
        <EditCustomerDialog customer={c} onClose={() => setEditOpen(false)} onSuccess={invalidate} />
      )}
      {deleteOpen && (
        <DeleteCustomerDialog
          customer={c}
          onClose={() => setDeleteOpen(false)}
          onSuccess={() => navigate("/admin/customers")}
        />
      )}
    </div>
  );
}
