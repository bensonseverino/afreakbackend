import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  PageHeader,
  Spinner,
  StatCard,
  Table,
  useToast,
} from "../components/ui";
import { API_ORIGIN, SITE_URL } from "./contentTools";

/**
 * /admin/diagnostics (CMS CONNECTION FIX §7.4) — one page that answers
 * "is it connected?" for every CMS module, and proves the admin and the
 * storefront read the same D1/R2.
 */

const LIVE_TARGETS = [
  { key: "heroSlides", path: "/home", count: (d) => (d?.heroSlides ?? []).length },
  { key: "lookbook", path: "/lookbook", count: (d) => (Array.isArray(d) ? d.length : 0) },
  { key: "products", path: "/products?limit=48", count: (d) => (Array.isArray(d) ? d.length : 0) },
  { key: "categories", path: "/categories", count: (d) => (Array.isArray(d) ? d.length : 0) },
  { key: "promoBar", path: "/home", count: (d) => (d?.promoBar?.text ? 1 : 0) },
  { key: "shippingBanner", path: "/home", count: (d) => (d?.shippingBanner?.title ? 1 : 0) },
  { key: "showcase", path: "/home", count: (d) => (d?.showcase ? 1 : 0) },
  { key: "footer", path: "/home", count: (d) => (d?.footer?.blurb ? 1 : 0) },
];

function IdentityRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 last:border-0">
      <span className="label text-stone">{label}</span>
      <span className="break-all text-right font-mono text-[12px] text-ink">{value ?? "—"}</span>
    </div>
  );
}

export default function Diagnostics() {
  const toast = useToast();
  const [liveResults, setLiveResults] = useState(null);
  const [liveError, setLiveError] = useState(null);

  const diag = useQuery({
    queryKey: ["admin-diagnostics"],
    queryFn: () => api("/admin/diagnostics").then((r) => r.data),
    refetchOnWindowFocus: true,
  });

  const recalc = useMutation({
    mutationFn: () => api("/admin/diagnostics/recalc", { method: "POST" }).then((r) => r.data),
    onSuccess: (data) => {
      toast.push(`Recalculated ${data?.updated ?? 0} product(s)`);
      diag.refetch();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const mediaHealth = useMutation({
    mutationFn: () => api("/admin/media/health").then((r) => r.data),
    onSuccess: (data) =>
      toast.push(
        data?.missing?.length
          ? `${data.missing.length} media file(s) missing from R2`
          : `All ${data?.checked ?? 0} media files present in R2`,
        data?.missing?.length ? "danger" : "ink",
      ),
    onError: (e) => toast.push(e.message, "danger"),
  });

  /** Fetch each public endpoint from the browser and compare with the DB counts. */
  const runLiveCheck = async () => {
    setLiveError(null);
    const results = [];
    for (const target of LIVE_TARGETS) {
      try {
        const res = await fetch(`${API_ORIGIN}/api${target.path}?_=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          results.push({ ...target, count: null, error: `HTTP ${res.status}` });
          continue;
        }
        const json = await res.json();
        results.push({ ...target, count: target.count(json?.data), error: null });
      } catch (err) {
        results.push({ ...target, count: null, error: err?.message || "network error" });
      }
    }
    setLiveResults(results);
  };

  if (diag.isLoading) return <Spinner label="Running diagnostics" />;
  if (diag.isError) {
    return (
      <Card className="p-6">
        <p className="label text-danger">{diag.error?.message || "Diagnostics unavailable"}</p>
        <p className="mt-2 text-[13px] text-stone">
          Owner access is required for this page.
        </p>
      </Card>
    );
  }

  const { identity, modules, checkedAt } = diag.data ?? {};
  const mismatch = (modules ?? []).filter((m) => m.status === "MISMATCH").length;
  const empty = (modules ?? []).filter((m) => m.status === "EMPTY").length;

  return (
    <div>
      <PageHeader title="Diagnostics">
        <Button variant="outline" size="sm" onClick={() => diag.refetch()}>
          REFRESH
        </Button>
        <Button size="sm" onClick={runLiveCheck}>
          RUN LIVE CHECK
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mediaHealth.mutate()}
          disabled={mediaHealth.isPending}
        >
          CHECK MEDIA
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => recalc.mutate()}
          disabled={recalc.isPending}
        >
          RECALC PRICES
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Modules connected" value={`${(modules ?? []).length - mismatch - empty}/${(modules ?? []).length}`} />
        <StatCard label="Mismatches" value={mismatch} sub={mismatch ? "public API differs from DB" : "none"} />
        <StatCard label="Content version" value={identity?.contentVersion ?? 0} sub={`checked ${checkedAt ?? ""}`} />
      </div>

      <Card className="mt-4 p-5">
        <p className="label mb-2 text-graphite">Environment</p>
        <IdentityRow label="Environment" value={identity?.env} />
        <IdentityRow label="Build / commit" value={identity?.buildId} />
        <IdentityRow label="Branch" value={identity?.branch} />
        <IdentityRow label="Pages URL" value={identity?.deploymentUrl} />
        <IdentityRow label="D1 binding id hash" value={identity?.dbId} />
        <IdentityRow label="Schema migrations applied" value={identity?.schemaVersion} />
        <IdentityRow label="R2 bucket" value={identity?.bucket} />
        <IdentityRow label="API origin" value={API_ORIGIN || window.location.origin} />
        <IdentityRow label="Storefront" value={SITE_URL} />
        <IdentityRow
          label="Row counts"
          value={Object.entries(identity?.counts ?? {})
            .map(([table, n]) => `${table}:${n}`)
            .join("  ")}
        />
        <p className="mt-3 text-[12px] text-stone">
          The storefront must report the same D1 binding id hash and content version: open{" "}
          <span className="font-mono">/api/health</span> on the API origin and compare.
        </p>
      </Card>

      <div className="mt-4">
        <Table head={["Module", "API", "DB active", "Public API", "Status", "Note"]}>
          {(modules ?? []).map((module) => (
            <tr key={module.key} className="border-b border-line last:border-0">
              <td className="px-4 py-3 text-[13px] font-medium">{module.label}</td>
              <td className="px-4 py-3 font-mono text-[11px] text-stone">{module.api}</td>
              <td className="px-4 py-3 text-[13px]">{module.dbCount}</td>
              <td className="px-4 py-3 text-[13px]">{module.publicCount}</td>
              <td className="px-4 py-3">
                {module.status === "CONNECTED" ? (
                  <Badge tone="ok">✓ CONNECTED</Badge>
                ) : module.status === "EMPTY" ? (
                  <Badge tone="stone">EMPTY</Badge>
                ) : (
                  <Badge tone="danger">✗ MISMATCH</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-[12px] text-stone">{module.note ?? ""}</td>
            </tr>
          ))}
        </Table>
      </div>

      {liveResults && (
        <Card className="mt-4 p-5">
          <p className="label mb-3 text-graphite">Live check (browser → public API)</p>
          <div className="space-y-2">
            {liveResults.map((result) => {
              const db = (modules ?? []).find((m) => m.key === result.key);
              const ok = !result.error && db && result.count >= Math.min(db.dbCount, db.publicCount);
              return (
                <div key={result.key} className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-0">
                  <span className="text-[13px]">{result.key}</span>
                  <span className="font-mono text-[12px] text-stone">
                    live {result.error ?? result.count} · db {db?.dbCount ?? "?"} · api {db?.publicCount ?? "?"}
                  </span>
                  {ok ? <Badge tone="ok">✓</Badge> : <Badge tone="danger">✗</Badge>}
                </div>
              );
            })}
          </div>
          {liveError && <p className="mt-3 text-[12px] text-danger">{liveError}</p>}
          <p className="mt-3 text-[12px] text-stone">
            A mismatch here means a cache or deployment problem: the database has the content but the
            browser cannot see it. Check Cache Rules for <span className="font-mono">/api/*</span> and
            confirm the latest deployment is live.
          </p>
        </Card>
      )}
    </div>
  );
}
