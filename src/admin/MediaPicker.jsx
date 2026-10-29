import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { uploadMedia } from "../lib/imageUpload";
import { Badge, Button, Modal, Spinner, TextInput, useToast } from "../components/ui";

/**
 * MediaPicker (CMS CONNECTION FIX §7.2).
 *
 * A grid of media thumbnails with search, inline upload (button + drag & drop)
 * and multi-select. It always resolves to `media.id` values — never a filename
 * or an empty string — which is what cause C-10 was about.
 *
 * The body only mounts while the modal is open, so a fresh open always starts
 * from `selectedIds` instead of syncing state inside an effect.
 */
function PickerBody({ onClose, onSelect, multiple, max, selectedIds, title }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(multiple ? selectedIds : []);
  const [dragging, setDragging] = useState(false);

  const list = useQuery({
    queryKey: ["media-picker", q],
    queryFn: () => api(`/admin/media?q=${encodeURIComponent(q)}&limit=60`).then((r) => r.data),
  });

  const upload = useMutation({
    mutationFn: (files) => uploadMedia(files, "products"),
    onSuccess: (res) => {
      toast.push(`${res?.data?.length ?? 0} file(s) uploaded`);
      list.refetch();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const toggle = (id) => {
    if (!multiple) {
      setPicked([id]);
      return;
    }
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((value) => value !== id);
      if (prev.length >= max) {
        toast.push(`Up to ${max} can be selected`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const confirm = () => {
    if (!picked.length) {
      toast.push("Select at least one image", "danger");
      return;
    }
    const items = (list.data ?? []).filter((item) => picked.includes(item.id));
    onSelect(picked, items);
    onClose?.();
  };

  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          placeholder="Search media…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? "Uploading…" : "Upload new"}
        </Button>
        <span className="label ml-auto text-stone">
          {picked.length} selected · {multiple ? `${max} max` : title}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) upload.mutate(files);
            e.target.value = "";
          }}
        />
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = [...(e.dataTransfer?.files ?? [])];
          if (files.length) upload.mutate(files);
        }}
        className={`p-1 ${dragging ? "bg-volt/20 outline outline-2 outline-volt" : ""}`}
      >
        {list.isLoading ? (
          <Spinner label="Loading media" />
        ) : rows.length === 0 ? (
          <p className="label py-10 text-center text-stone">
            No media yet — upload files or drop them here.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {rows.map((item) => {
              const active = picked.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item.id)}
                  className={`group relative border text-left ${
                    active ? "border-ink outline outline-2 outline-ink" : "border-line hover:border-ink"
                  }`}
                >
                  <div className="aspect-[3/4] bg-mist overflow-hidden">
                    <img
                      src={item.url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.visibility = "hidden";
                      }}
                    />
                  </div>
                  <span className="label block truncate px-1 py-0.5 text-[10px] text-stone">
                    {item.filename || item.key}
                  </span>
                  {active && (
                    <span className="absolute right-1 top-1">
                      <Badge tone="solid">✓</Badge>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={confirm}>Add selected</Button>
      </div>
    </div>
  );
}

export default function MediaPicker({
  open,
  onClose,
  onSelect,
  multiple = false,
  max = 1,
  selectedIds = [],
  title = "Choose media",
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={multiple ? `${title} · up to ${max}` : title}
      wide
    >
      {open && (
        <PickerBody
          onClose={onClose}
          onSelect={onSelect}
          multiple={multiple}
          max={max}
          selectedIds={selectedIds}
          title={title}
        />
      )}
    </Modal>
  );
}
