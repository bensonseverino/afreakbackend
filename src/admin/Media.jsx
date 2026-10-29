import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { uploadMedia } from "../lib/imageUpload";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  TextInput,
  useToast,
} from "../components/ui";

function humanSize(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export default function Media() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef(null);
  const [q, setQ] = useState("");
  const [prefix, setPrefix] = useState("products");
  const [page, setPage] = useState(1);
  const [alt, setAlt] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [missing, setMissing] = useState([]);

  const list = useQuery({
    queryKey: ["admin-media", q, page],
    queryFn: () => api(`/admin/media?q=${encodeURIComponent(q)}&page=${page}`).then((r) => r),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-media"] });

  const upload = useMutation({
    mutationFn: (files) => uploadMedia(files, prefix),
    onSuccess: (res) => {
      toast.push(`${res?.data?.length ?? 0} file(s) uploaded`);
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const saveAlt = useMutation({
    mutationFn: ({ id, value }) => api(`/admin/media/${id}`, { method: "PATCH", body: { alt: value } }),
    onSuccess: () => {
      toast.push("Alt text saved");
      setAlt(null);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/media/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.push("Media deleted");
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  // Media health (§7.3): rows whose R2 object is gone. A CMS image that 404s
  // is invisible on the storefront, so surface it here.
  const health = useMutation({
    mutationFn: () => api("/admin/media/health").then((r) => r.data),
    onSuccess: (data) => {
      setMissing(data?.missing ?? []);
      toast.push(
        data?.missing?.length
          ? `${data.missing.length} file(s) missing from R2`
          : `All ${data?.checked ?? 0} files present in R2`,
        data?.missing?.length ? "danger" : "ink",
      );
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;
  const isMissing = (id) => missing.some((m) => m.id === id);

  const onFiles = (e) => {
    const files = [...(e.target.files ?? [])];
    if (files.length) upload.mutate(files);
    e.target.value = "";
  };

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${url}`);
      toast.push("URL copied");
    } catch {
      toast.push("Copy failed", "danger");
    }
  };

  return (
    <div>
      <PageHeader title="Media library">
        <Select value={prefix} onChange={(e) => setPrefix(e.target.value)} className="!w-auto">
          <option value="products">products/</option>
          <option value="categories">categories/</option>
          <option value="hero">hero/</option>
          <option value="lookbook">lookbook/</option>
        </Select>
        <Button variant="outline" onClick={() => health.mutate()} disabled={health.isPending}>
          {health.isPending ? "Checking…" : "CHECK MEDIA"}
        </Button>
        <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? "Uploading…" : "Upload"}
        </Button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
      </PageHeader>

      <Card className="mb-4 p-4">
        <Field label="Search">
          <TextInput
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Filename, key or alt"
          />
        </Field>
      </Card>

      {list.isLoading && <Spinner />}

      {list.data && rows.length === 0 && (
        <EmptyState title="No media" hint="Upload product photos to get started." />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((m) => (
          <Card key={m.id} className="overflow-hidden">
            <img src={m.url} alt={m.alt ?? ""} className="h-40 w-full bg-mist object-cover" />
            <div className="p-3">
              <p className="truncate text-[12px] text-graphite">{m.filename || m.key}</p>
              {isMissing(m.id) && (
                <p className="mt-1">
                  <Badge tone="danger">MISSING FILE</Badge>
                </p>
              )}
              <p className="mt-1 text-[11px] text-stone">
                {humanSize(m.size)}
                {m.width ? ` · ${m.width}×${m.height}` : ""}
                {m.size > 500 * 1024 && <span className="text-warn"> · large</span>}
              </p>

              {alt?.id === m.id ? (
                <div className="mt-2 flex gap-1">
                  <TextInput
                    autoFocus
                    className="!py-1.5 !text-[12px]"
                    defaultValue={m.alt ?? ""}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveAlt.mutate({ id: m.id, value: e.target.value });
                    }}
                  />
                  <Button size="sm" variant="outline" onClick={() => setAlt(null)}>
                    ✕
                  </Button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setAlt({ id: m.id })}>
                    Alt
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => copy(m.url)}>
                    URL
                  </Button>
                  <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setConfirm(m)}>
                    Del
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      {meta && <Pagination page={meta.page} pages={meta.pages} onChange={setPage} />}

      <ConfirmDialog
        open={!!confirm}
        title="Delete media"
        message="This removes the file from storage. Images in use cannot be deleted."
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
