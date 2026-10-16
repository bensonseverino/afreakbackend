import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Pagination,
  Spinner,
  useToast,
} from "../components/ui";

const TABS = ["pending", "approved", "rejected"];

export default function Reviews() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(null);

  const list = useQuery({
    queryKey: ["admin-reviews", status, page],
    queryFn: () => api(`/admin/reviews?status=${status}&page=${page}`).then((r) => r),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-reviews"] });

  const setStatusMutation = useMutation({
    mutationFn: ({ id, value }) => api(`/admin/reviews/${id}`, { method: "PATCH", body: { status: value } }),
    onSuccess: (_d, v) => {
      toast.push(v.value === "approved" ? "Review approved" : "Review rejected");
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/reviews/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.push("Review deleted");
      invalidate();
    },
  });

  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;
  const counts = meta?.counts ?? {};

  return (
    <div>
      <PageHeader title="Reviews" />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => {
              setStatus(t);
              setPage(1);
            }}
            className={`label px-4 py-2.5 ${
              status === t ? "border-b-2 border-ink text-ink" : "text-stone hover:text-ink"
            }`}
          >
            {t} ({counts[t] ?? 0})
          </button>
        ))}
      </div>

      {list.isLoading && <Spinner />}
      {list.data && rows.length === 0 && <EmptyState title={`No ${status} reviews`} />}

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[15px] font-medium">{r.title || "(no title)"}</p>
                <p className="text-[12px] text-stone">
                  {"★".repeat(r.rating)}
                  {"☆".repeat(5 - r.rating)} · {r.author} · {formatDate(r.createdAt)}
                </p>
              </div>
              {r.verified && <Badge tone="ok">Verified</Badge>}
            </div>
            <p className="mt-3 text-[13px] text-graphite">{r.body}</p>
            <p className="mt-3 text-[12px] text-stone">
              On <span className="text-graphite">{r.productName}</span>
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {r.status !== "approved" && (
                <Button size="sm" onClick={() => setStatusMutation.mutate({ id: r.id, value: "approved" })}>
                  Approve
                </Button>
              )}
              {r.status !== "rejected" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setStatusMutation.mutate({ id: r.id, value: "rejected" })}
                >
                  Reject
                </Button>
              )}
              <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setConfirm(r)}>
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {meta && <Pagination page={meta.page} pages={meta.pages} onChange={setPage} />}

      <ConfirmDialog
        open={!!confirm}
        title="Delete review"
        message="This permanently removes the review and recomputes the product rating."
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
