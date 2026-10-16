/**
 * Thin typed wrappers around D1 so route handlers stay readable.
 * Every query is a prepared statement — never string-concatenated.
 */

export function first<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...params)
    .first<T>();
}

export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return res.results ?? [];
}

export function run(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<D1Result> {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}

/** Count helper for pagination metadata. */
export async function count(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const row = await first<{ n: number }>(db, sql, params);
  return Number(row?.n ?? 0);
}

/**
 * Run an array of statements atomically. Statements are built as
 * `{ sql, params }` objects so callers never concatenate values in.
 */
export type BatchStatement = { sql: string; params?: unknown[] };

export function batchStatements(
  db: D1Database,
  statements: BatchStatement[],
): D1PreparedStatement[] {
  return statements.map((s) => db.prepare(s.sql).bind(...(s.params ?? [])));
}

export function batch(db: D1Database, statements: BatchStatement[]): Promise<D1Result[]> {
  return db.batch(batchStatements(db, statements));
}
