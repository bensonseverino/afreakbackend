import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatusDot,
  TextArea,
  useToast,
} from "../components/ui";

const TYPES = [
  ["", "All"],
  ["contact", "Contact"],
  ["custom_print", "Custom print"],
  ["notify_me", "Notify me"],
];
const STATUSES = ["new", "read", "replied", "archived"];

export default function Inbox() {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const list = useQuery({
    queryKey: ["admin-submissions", type, status, page],
    queryFn: () =>
      api(`/admin/submissions?type=${type}&status=${status}&page=${page}`).then((r) => r),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-submissions"] });

  const patch = useMutation({
    mutationFn: ({ id, value }) => api(`/admin/submissions/${id}`, { method: "PATCH", body: { status: value } }),
    onSuccess: () => {
      invalidate();
      toast.push("Updated");
    },
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/submissions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.push("Deleted");
      setOpen(null);
    },
  });

  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;
  const counts = meta?.counts ?? {};

  return (
    <div>
      <PageHeader title="Inbox">
        <a
          href="/api/admin/submissions/export.csv"
          className="label inline-flex items-center border border-line bg-card px-4 py-2.5 hover:border-ink"
        >
          Export CSV
        </a>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TYPES.map(([value, label]) => (
          <button
            key={value}
            onClick={() => {
              setType(value);
              setPage(1);
            }}
            className={`label border px-3 py-2 ${
              type === value ? "border-ink bg-ink text-paper" : "border-line bg-card text-stone hover:text-ink"
            }`}
          >
            {label} {value === "" ? counts.all ?? "" : counts[value] ? `(${counts[value]})` : ""}
          </button>
        ))}
        <div className="ml-auto">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="!w-auto"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {list.isLoading && <Spinner />}
      {list.data && rows.length === 0 && <EmptyState title="Nothing here" />}

      <div className="flex flex-col gap-2">
        {rows.map((s) => (
          <Card
            key={s.id}
            className={`flex cursor-pointer items-center justify-between gap-4 p-4 hover:border-ink ${
              s.status === "new" ? "border-l-[3px] border-l-ink" : ""
            }`}
            onClick={() => setOpen(s)}
          >
            <div className="min-w-0">
              <p className={`truncate text-[14px] ${s.status === "new" ? "font-medium" : "text-graphite"}`}>
                {s.subject || s.type.replace("_", " ")} — {s.name || s.email}
              </p>
              <p className="truncate text-[12px] text-stone">{s.message || JSON.stringify(s.payload)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[12px] text-stone">{formatDateTime(s.createdAt)}</span>
              <StatusDot tone={s.status === "new" ? "warn" : s.status === "archived" ? "graphite" : "ok"} />
            </div>
          </Card>
        ))}
      </div>

      {meta && <Pagination page={meta.page} pages={meta.pages} onChange={setPage} />}

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `${open.type.replace("_", " ")} — ${open.name || open.email}` : ""}
        footer={
          open && (
            <>
              <a
                href={`mailto:${open.email}?subject=Re: ${encodeURIComponent(open.subject || "Your message")}`}
                className="label inline-flex items-center border border-line px-4 py-2.5 hover:border-ink"
              >
                Reply by email
              </a>
              <Button variant="ghost" className="!text-danger" onClick={() => setConfirm(open)}>
                Delete
              </Button>
            </>
          )
        }
      >
        {open && (
          <div className="space-y-3 text-[13px]">
            <p className="text-graphite">{open.email}</p>
            {open.subject && <p className="text-stone">Subject: {open.subject}</p>}
            {open.message && <p className="whitespace-pre-wrap">{open.message}</p>}
            {Object.keys(open.payload ?? {}).length > 0 && (
              <div className="border border-line bg-mist p-3">
                <p className="label mb-2 text-stone">Payload</p>
                {Object.entries(open.payload).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-stone">{k}:</span>
                    <span className="text-graphite">
                      {String(v?.artworkKey ?? v ?? "—")}
                    </span>
                  </div>
                ))}
                {open.payload.artworkKey && (
                  <a
                    className="label mt-2 inline-block text-ink underline"
                    href={`/api/admin/artwork/${String(open.payload.artworkKey).replace(/^artwork\//, "")}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download artwork
                  </a>
                )}
              </div>
            )}
            <div>
              <p className="label mb-2 text-stone">Status</p>
              <Select value={open.status} onChange={(e) => patch.mutate({ id: open.id, value: e.target.value })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title="Delete submission"
        message="This cannot be undone."
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
