/**
 * Deployment identity (CMS CONNECTION FIX §C-1).
 *
 * Answers "are the admin and the storefront talking to the same D1/R2?" —
 * the schema fingerprint identifies the database lineage, `contentVersion`
 * and the row counts prove it is the same data set, and the build id identifies
 * which deployment answered.
 */
import type { Env } from "../env";
import { all, first } from "./db";
import { getContentVersion } from "./contentVersion";

export type ContentIdentity = {
  env: string;
  buildId: string | null;
  commit: string | null;
  branch: string | null;
  deploymentUrl: string | null;
  /** Stable hash of the D1 binding name + applied migration names. */
  dbId: string;
  schemaVersion: number;
  bucket: string;
  contentVersion: number;
  counts: Record<string, number>;
};

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function migrationNames(env: Env): Promise<string[]> {
  try {
    const rows = await all<{ name: string }>(env.DB, "SELECT name FROM d1_migrations ORDER BY id");
    return rows.map((r) => String(r.name));
  } catch {
    // `d1_migrations` is absent in a database that was never migrated with wrangler.
    return [];
  }
}

export async function getIdentity(env: Env): Promise<ContentIdentity> {
  const [migrations, contentVersion] = await Promise.all([
    migrationNames(env),
    getContentVersion(env),
  ]);

  const counts: Record<string, number> = {};
  const tables = ["hero_slides", "lookbook_items", "products", "categories", "media"];
  const countRows = await Promise.all(
    tables.map((table) =>
      first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM ${table}`).catch(() => null),
    ),
  );
  tables.forEach((table, i) => {
    counts[table] = Number(countRows[i]?.n ?? 0);
  });

  const dbId = fnv1a(`DB|${migrations.join(",")}`);

  // A preview deployment is any branch other than the production branch — the
  // mistake that made previews look connected while writing elsewhere (C-1).
  const branch = env.CF_PAGES_BRANCH ?? null;
  const productionBranch = env.PRODUCTION_BRANCH ?? "main";
  const environment = !branch
    ? (env.APP_ENV ?? "development")
    : branch === productionBranch
      ? (env.APP_ENV ?? "production")
      : `preview (${branch})`;

  return {
    env: environment,
    buildId: env.APP_BUILD_ID || env.CF_PAGES_COMMIT_SHA?.slice(0, 7) || null,
    commit: env.CF_PAGES_COMMIT_SHA ?? null,
    branch,
    deploymentUrl: env.CF_PAGES_URL ?? null,
    dbId,
    schemaVersion: migrations.length,
    bucket: env.MEDIA_BUCKET_NAME ?? "afreak-products",
    contentVersion,
    counts,
  };
}
