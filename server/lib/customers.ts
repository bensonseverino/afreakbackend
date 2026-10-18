/**
 * The `customers` table, in one place.
 *
 * Accounts are Afreak's own now: a customer signs up with an email address or a
 * phone number plus a password, an admin approves the request in the CMS, and
 * everything the storefront knows about them is keyed on this row. The helpers
 * here are shared by the public account routes, the admin routes and the
 * order/checkout paths.
 */
import { first, run, type BatchStatement } from "./db";

export type CustomerStatus = "pending" | "active" | "rejected" | "suspended" | "deleted";
export type SignupSource = "self" | "admin" | "migrated";
export type AuthChannel = "email" | "phone";

/** Every column of `customers`, spelled once so reads stay in step. */
export const CUSTOMER_COLUMNS = `id, email, phone_e164, first_name, last_name,
       password_hash, password_salt, must_change_password, password_changed_at,
       status, signup_source, approved_at, approved_by, rejected_reason,
       admin_notes, marketing_opt_in, provider_customer_id, last_login_at,
       created_at, updated_at, deleted_at`;

export type CustomerRow = {
  id: string;
  email: string | null;
  phone_e164: string | null;
  first_name: string | null;
  last_name: string | null;
  password_hash: string | null;
  password_salt: string | null;
  must_change_password: number;
  password_changed_at: string | null;
  status: string;
  signup_source: string;
  approved_at: string | null;
  approved_by: string | null;
  rejected_reason: string | null;
  admin_notes: string | null;
  marketing_opt_in: number;
  provider_customer_id: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * The request-scoped identity handed to route handlers. Never carries password
 * material — that stays inside the auth routes.
 */
export type Customer = {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  status: CustomerStatus;
  mustChangePassword: boolean;
  marketingOptIn: boolean;
  createdAt: string;
};

/** `CUSTOMER_COLUMNS` qualified with a table alias, for joins. */
export function customerColumns(alias: string): string {
  return CUSTOMER_COLUMNS.split(",")
    .map((column) => `${alias}.${column.trim()}`)
    .join(", ");
}

export function customerFromRow(row: CustomerRow): Customer {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone_e164,
    firstName: row.first_name,
    lastName: row.last_name,
    status: row.status as CustomerStatus,
    mustChangePassword: row.must_change_password === 1,
    marketingOptIn: row.marketing_opt_in === 1,
    createdAt: row.created_at,
  };
}

export function isSignupSource(value: unknown): value is SignupSource {
  return value === "self" || value === "admin" || value === "migrated";
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** Normalised contact column backing a channel: `email` or `phone_e164`. */
export function identifierColumn(channel: AuthChannel): "email" | "phone_e164" {
  return channel === "phone" ? "phone_e164" : "email";
}

/**
 * Look a customer up by the identifier they signed in with.
 *
 * The column comes from `identifierColumn` (never from user input) and the value
 * is already normalised by the caller, so this is a plain indexed lookup.
 */
export function findCustomerByIdentifier(
  db: D1Database,
  channel: AuthChannel,
  identifier: string,
): Promise<CustomerRow | null> {
  return first<CustomerRow>(
    db,
    `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE ${identifierColumn(channel)} = ?`,
    [identifier],
  );
}

export function findCustomerById(db: D1Database, id: string): Promise<CustomerRow | null> {
  return first<CustomerRow>(db, `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE id = ?`, [id]);
}

/** Is this email/phone already taken? Excludes the row being edited. */
export async function identifierTaken(
  db: D1Database,
  channel: AuthChannel,
  identifier: string,
  exceptId?: string,
): Promise<boolean> {
  const row = await first<{ id: string }>(
    db,
    `SELECT id FROM customers WHERE ${identifierColumn(channel)} = ?${
      exceptId ? " AND id != ?" : ""
    }`,
    exceptId ? [identifier, exceptId] : [identifier],
  );
  return row !== null;
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export type AuditAction =
  | "signup"
  | "create"
  | "approve"
  | "reject"
  | "suspend"
  | "unsuspend"
  | "reset_password"
  | "edit"
  | "delete"
  | "link_orders";

/** Append to the immutable trail the CMS shows on an account. */
export async function audit(
  db: D1Database,
  entry: {
    customerId: string;
    adminId?: string | null;
    action: AuditAction;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await run(
    db,
    `INSERT INTO customer_audit_log (customer_id, admin_id, action, detail_json)
     VALUES (?, ?, ?, ?)`,
    [
      entry.customerId,
      entry.adminId ?? null,
      entry.action,
      entry.detail ? JSON.stringify(entry.detail) : null,
    ],
  );
}

/**
 * Unlinked orders whose contact details look like this customer's.
 *
 * Sign-up details are *not* verified, so this is only ever a hint for an admin —
 * it is never applied automatically (see `linkGuestOrders`).
 */
export async function countGuestOrderMatches(
  db: D1Database,
  email: string | null,
  phoneE164: string | null,
): Promise<number> {
  if (!email && !phoneE164) return 0;
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM orders o
      WHERE o.customer_id IS NULL
        AND ((? IS NOT NULL AND lower(o.email) = ?) OR (? IS NOT NULL AND o.phone_e164 = ?))`,
    [email, email, phoneE164, phoneE164],
  );
  return Number(row?.n ?? 0);
}

/**
 * Adopt unclaimed guest orders for a customer. Explicit admin action only.
 * Returns how many rows were adopted.
 */
export async function linkGuestOrders(
  db: D1Database,
  customerId: string,
  email: string | null,
  phoneE164: string | null,
): Promise<number> {
  const result = await run(
    db,
    `UPDATE orders SET customer_id = ?
      WHERE customer_id IS NULL
        AND ((? IS NOT NULL AND lower(email) = ?) OR (? IS NOT NULL AND phone_e164 = ?))`,
    [customerId, email, email, phoneE164, phoneE164],
  );
  return result.meta?.changes ?? 0;
}

/** Sign every device out. Optionally keep the session making the request. */
export async function revokeCustomerSessions(
  db: D1Database,
  customerId: string,
  exceptIdHash?: string,
): Promise<void> {
  if (exceptIdHash) {
    await run(db, "DELETE FROM customer_sessions WHERE customer_id = ? AND id_hash != ?", [
      customerId,
      exceptIdHash,
    ]);
    return;
  }
  await run(db, "DELETE FROM customer_sessions WHERE customer_id = ?", [customerId]);
}

/**
 * Erase a customer's personal data, keeping the row as an anonymous tombstone so
 * orders and the audit trail keep their referent. Idempotent.
 *
 * Orders are deliberately *unlinked* rather than deleted: they stay for
 * accounting, and freeing the email/phone lets the person sign up again.
 */
export async function anonymizeCustomer(
  db: D1Database,
  customerId: string,
  adminId?: string | null,
): Promise<void> {
  const statements: BatchStatement[] = [
    { sql: "DELETE FROM customer_sessions WHERE customer_id = ?", params: [customerId] },
    { sql: "DELETE FROM password_reset_requests WHERE customer_id = ?", params: [customerId] },
    // TODO: delete `addresses`, `payment_methods` and `wishlist_items` rows too
    // once the account-dashboard tables land; detach saved payment methods at the
    // provider before removing local tokens.
    { sql: "UPDATE orders SET customer_id = NULL WHERE customer_id = ?", params: [customerId] },
    {
      sql: `UPDATE customers
               SET status = 'deleted', deleted_at = datetime('now'),
                   email = NULL, phone_e164 = NULL, first_name = NULL, last_name = NULL,
                   password_hash = NULL, password_salt = NULL, must_change_password = 0,
                   admin_notes = NULL, marketing_opt_in = 0, provider_customer_id = NULL,
                   updated_at = datetime('now')
             WHERE id = ?`,
      params: [customerId],
    },
  ];

  await db.batch(statements.map((s) => db.prepare(s.sql).bind(...(s.params ?? []))));
  await audit(db, { customerId, adminId, action: "delete" });
}

/** The E.164 form of a free-text phone, for `orders.phone_e164`. */
export { normalizePhoneE164, toE164 } from "./phone";
