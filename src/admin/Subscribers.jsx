import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  Pagination,
  Spinner,
  Table,
  TextInput,
  useToast,
} from "../components/ui";

export default function Subscribers() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(null);

  const list = useQuery({
    queryKey: ["admin-subscribers", q, page],
    queryFn: () => api(`/admin/subscribers?q=${encodeURIComponent(q)}&page=${page}`).then((r) => r),
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/subscribers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.push("Removed");
      qc.invalidateQueries({ queryKey: ["admin-subscribers"] });
    },
  });

  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;

  return (
    <div>
      <PageHeader title="Subscribers">
        <a
          href="/api/admin/subscribers/export.csv"
          className="label inline-flex items-center border border-line bg-card px-4 py-2.5 hover:border-ink"
        >
          Export CSV
        </a>
      </PageHeader>

      <Card className="mb-4 p-4">
        <Field label="Search">
          <TextInput
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Email"
          />
        </Field>
      </Card>

      {list.isLoading && <Spinner />}
      {list.data && rows.length === 0 && <EmptyState title="No subscribers" />}

      {rows.length > 0 && (
        <>
          <Table head={["Email", "Source", "Status", "Joined", ""]}>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">{s.email}</td>
                <td className="px-4 py-3 text-stone">{s.source || "—"}</td>
                <td className="px-4 py-3">{s.status}</td>
                <td className="px-4 py-3 whitespace-nowrap text-stone">{formatDate(s.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setConfirm(s)}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={meta.page} pages={meta.pages} onChange={setPage} />
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        title="Remove subscriber"
        message={`Remove ${confirm?.email}?`}
        confirmLabel="Remove"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          remove.mutate(confirm.id);
          setConfirm(null);
        }}
      />
    </div>
  );
}
