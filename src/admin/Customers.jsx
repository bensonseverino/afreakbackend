import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  Pagination,
  Spinner,
  StatusDot,
  TextInput,
  useToast,
} from "../components/ui";
import CreateAccountDrawer from "./CreateAccountDrawer";
import {
  ApproveDialog,
  RejectDialog,
  ResetPasswordDialog,
  SourceBadge,
} from "./customerWidgets";
import {
  STATUS_META,
  STATUS_TABS,
  displayName,
  initials,
  primaryContact,
  relativeTime,
} from "./customerUtils";

/** Square initial tile that starts every row/card. */
function InitialTile({ customer }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-ink font-display text-[13px] font-extrabold text-paper">
      {initials(customer)}
    </span>
  );
}

function StatusCell({ status }) {
  const meta = STATUS_META[status] ?? { tone: "graphite", label: status };
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px]">
      <StatusDot tone={meta.tone} />
      {meta.label}
    </span>
  );
}

export default function Customers() {
  const qc = useQueryClient();
  const toast = useToast();
  const timer = useRef();

  const [tab, setTab] = useState("pending");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [approveTarget, setApproveTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const onSearch = (value) => {
    setQ(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDebouncedQ(value);
      setPage(1);
    }, 300);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-customers"] });
    qc.invalidateQueries({ queryKey: ["admin-customer-counts"] });
    qc.invalidateQueries({ queryKey: ["admin-password-requests"] });
  };

  const list = useQuery({
    queryKey: ["admin-customers", tab, debouncedQ, page],
    queryFn: () => {
      const params = new URLSearchParams({ status: tab, page: String(page), limit: "50" });
      if (debouncedQ) params.set("q", debouncedQ);
      return api(`/admin/customers?${params}`).then((r) => r);
    },
    placeholderData: (prev) => prev,
  });

  const countsQuery = useQuery({
    queryKey: ["admin-customer-counts"],
    queryFn: () => api("/admin/customers/counts").then((r) => r.data),
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });

  const requests = useQuery({
    queryKey: ["admin-password-requests"],
    queryFn: () => api("/admin/password-requests?status=open").then((r) => r.data),
    enabled: queueOpen,
  });

  const bulk = useMutation({
    mutationFn: (ids) =>
      api("/admin/customers/bulk-approve", { method: "POST", body: { ids } }).then((r) => r.data),
    onSuccess: (data) => {
      toast.push(`${data.approved} account${data.approved === 1 ? "" : "s"} approved`);
      setSelected(new Set());
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const dismiss = useMutation({
    mutationFn: (id) =>
      api(`/admin/password-requests/${id}/dismiss`, { method: "POST" }).then((r) => r.data),
    onSuccess: () => {
      toast.push("Request dismissed");
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;
  const counts = meta?.counts;
  const openReset = countsQuery.data?.openResetRequests ?? 0;
  const showSelect = tab === "pending";

  const changeTab = (next) => {
    setTab(next);
    setPage(1);
    setSelected(new Set());
  };

  const toggleRow = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (rows.every((r) => next.has(r.id))) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });

  const allSelected = showSelect && rows.length > 0 && rows.every((r) => selected.has(r.id));

  const tabs = STATUS_TABS.map(([key, label]) => {
    const n = key === "all" ? counts?.all : counts?.[key];
    return { key, label: typeof n === "number" ? `${label} (${n})` : label, n };
  });

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-[26px] font-extrabold uppercase tracking-tight">
          Customers
        </h1>
        <Button className="h-12 w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
          CREATE ACCOUNT
        </Button>
      </div>

      {/* Tabs + reset-request chip */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <div className="flex border border-line">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => changeTab(t.key)}
              className={`label whitespace-nowrap px-4 py-2.5 ${
                tab === t.key ? "bg-ink text-paper" : "bg-card text-stone hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setQueueOpen(true)}
          className={`label whitespace-nowrap border px-4 py-2.5 ${
            openReset > 0
              ? "border-warn text-warn"
              : "border-line bg-card text-stone hover:text-ink"
          }`}
        >
          Reset requests ({openReset})
        </button>
      </div>

      <div className="mb-4">
        <Field label="Search">
          <TextInput
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Name, email or phone"
          />
        </Field>
      </div>

      {list.isLoading && <Spinner />}
      {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}

      {list.data && rows.length === 0 && (
        <EmptyState
          title={tab === "pending" ? "No pending accounts" : "No accounts"}
          hint={
            tab === "pending"
              ? "You're all caught up."
              : "Nothing matches this filter yet."
          }
          action={
            tab === "pending" ? (
              <Button variant="outline" onClick={() => changeTab("all")}>
                VIEW ALL ACCOUNTS
              </Button>
            ) : undefined
          }
        />
      )}

      {rows.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto border border-line bg-card sm:block">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  {showSelect && (
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-ink"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all pending accounts"
                      />
                    </th>
                  )}
                  <th className="label px-4 py-3 text-stone">Name</th>
                  <th className="label px-4 py-3 text-stone">Contact</th>
                  <th className="label px-4 py-3 text-stone">Status</th>
                  <th className="label px-4 py-3 text-stone">Signed up</th>
                  <th className="label px-4 py-3 text-stone">Orders</th>
                  <th className="label px-4 py-3 text-stone">Source</th>
                  <th className="label px-4 py-3 text-stone">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0 hover:bg-mist">
                    {showSelect && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-ink"
                          checked={selected.has(c.id)}
                          onChange={() => toggleRow(c.id)}
                          aria-label={`Select ${displayName(c)}`}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/customers/${encodeURIComponent(c.id)}`}
                        className="flex items-center gap-3 hover:underline"
                      >
                        <InitialTile customer={c} />
                        <span className="font-medium">{displayName(c)}</span>
                      </Link>
                      {showSelect && c.guestOrderMatches > 0 && (
                        <p className="mt-1 text-[12px] text-graphite">
                          {c.guestOrderMatches} past guest order
                          {c.guestOrderMatches === 1 ? "" : "s"} match
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px] text-graphite">{c.email || "—"}</p>
                      {c.phone && <p className="text-[12px] text-stone">{c.phone}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusCell status={c.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[13px] text-stone">
                      {relativeTime(c.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-graphite">
                      {c.guestOrderMatches > 0 ? `${c.guestOrderMatches} guest` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <SourceBadge source={c.signupSource} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {showSelect ? (
                          <>
                            <Button size="sm" onClick={() => setApproveTarget(c)}>
                              APPROVE
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setRejectTarget(c)}
                            >
                              REJECT
                            </Button>
                          </>
                        ) : (
                          <Link
                            to={`/admin/customers/${encodeURIComponent(c.id)}`}
                            className="label border border-line px-3 py-2 text-graphite hover:border-ink"
                          >
                            OPEN
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 sm:hidden">
            {rows.map((c) => (
              <div key={c.id} className="border border-line bg-card p-4">
                <Link
                  to={`/admin/customers/${encodeURIComponent(c.id)}`}
                  className="flex items-center gap-3"
                >
                  <InitialTile customer={c} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{displayName(c)}</span>
                    <span className="mt-1 block truncate text-[12px] text-stone">
                      {primaryContact(c)}
                    </span>
                  </span>
                  <SourceBadge source={c.signupSource} />
                </Link>
                <div className="mt-3 flex items-center justify-between text-[12px]">
                  <StatusCell status={c.status} />
                  <span className="text-stone">{formatDate(c.createdAt)}</span>
                </div>
                {showSelect && c.guestOrderMatches > 0 && (
                  <p className="mt-2 text-[12px] text-graphite">
                    {c.guestOrderMatches} past guest order
                    {c.guestOrderMatches === 1 ? "" : "s"} match
                  </p>
                )}
                {showSelect && (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    <Button className="h-12 w-full" onClick={() => setApproveTarget(c)}>
                      APPROVE
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12 w-full"
                      onClick={() => setRejectTarget(c)}
                    >
                      REJECT
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <Pagination page={meta.page} pages={meta.pages} onChange={setPage} />
        </>
      )}

      {/* Sticky bulk bar */}
      {showSelect && selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-line bg-ink px-4 py-3 lg:left-[240px]">
          <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3">
            <span className="label text-white/70">{selected.size} selected</span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="!border-white/20 !text-white/70"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
              <Button
                variant="volt"
                disabled={bulk.isPending}
                onClick={() => bulk.mutate([...selected])}
              >
                {bulk.isPending ? "Approving…" : "APPROVE SELECTED"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reset-requests queue */}
      <Modal
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        title="Reset requests"
        wide
      >
        {requests.isLoading && <Spinner />}
        {requests.error && <ErrorState error={requests.error} onRetry={requests.refetch} />}
        {requests.data && requests.data.length === 0 && (
          <p className="py-6 text-center text-[13px] text-stone">
            No open password requests.
          </p>
        )}
        {requests.data && requests.data.length > 0 && (
          <div className="space-y-3">
            {requests.data.map((r) => (
              <div key={r.id} className="border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      to={`/admin/customers/${encodeURIComponent(r.customer.id)}`}
                      className="font-medium hover:underline"
                    >
                      {displayName(r.customer)}
                    </Link>
                    <p className="mt-1 text-[12px] text-stone">
                      {r.customer.email || r.customer.phone || "—"}
                    </p>
                    <p className="mt-1 text-[12px] text-stone">
                      Requested {relativeTime(r.createdAt)}
                    </p>
                  </div>
                  <StatusCell status={r.customer.status} />
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="h-12 w-full sm:w-auto"
                    onClick={() => {
                      setResetTarget(r.customer);
                      setQueueOpen(false);
                    }}
                  >
                    RESET PASSWORD
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 w-full sm:w-auto"
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate(r.id)}
                  >
                    DISMISS
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {approveTarget && (
        <ApproveDialog
          key={approveTarget.id}
          customer={approveTarget}
          onClose={() => setApproveTarget(null)}
          onSuccess={invalidate}
        />
      )}
      {rejectTarget && (
        <RejectDialog
          key={rejectTarget.id}
          customer={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onSuccess={invalidate}
        />
      )}
      {resetTarget && (
        <ResetPasswordDialog
          key={resetTarget.id}
          customer={resetTarget}
          onClose={() => setResetTarget(null)}
          onSuccess={invalidate}
        />
      )}

      {createOpen && (
        <CreateAccountDrawer
          onClose={() => setCreateOpen(false)}
          onSuccess={invalidate}
        />
      )}
    </div>
  );
}
