import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Env } from "../../env";
import { all, batch, count, first, run, type BatchStatement } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { cleanText, readJsonWithLimit, zodFields } from "../../lib/validate";
import { newId } from "../../lib/ids";
import { hashPassword } from "../../lib/password";
import { assertPassword, generateTempPassword, passwordProblem } from "../../lib/passwordPolicy";
import { toE164 } from "../../lib/phone";
import { setNoStore } from "../../middleware/cache";
import { requireOwner } from "../../middleware/auth";
import { notifyApproved, notifyRejected } from "../../lib/notify";
import {
  anonymizeCustomer,
  audit,
  countGuestOrderMatches,
  customerColumns,
  customerFromRow,
  findCustomerById,
  identifierTaken,
  linkGuestOrders,
  revokeCustomerSessions,
  type CustomerRow,
} from "../../lib/customers";

/**
 * The CMS side of customer accounts.
 *
 * Approval is the whole point: a self-signup cannot sign in until someone here
 * says yes, so these routes are the store's front desk. Every mutation writes a
 * `customer_audit_log` row, and the one-time temporary password is the only
 * secret that ever leaves the server.
 */
const app = new Hono<AppEnv>();

const LIST_STATUSES = ["pending", "active", "rejected", "suspended", "deleted"] as const;

function present(row: CustomerRow) {
  const customer = customerFromRow(row);
  return {
    id: customer.id,
    email: customer.email,
    phone: customer.phone,
    firstName: customer.firstName,
    lastName: customer.lastName,
    status: customer.status,
    signupSource: row.signup_source,
    marketingOptIn: customer.marketingOptIn,
    mustChangePassword: customer.mustChangePassword,
    adminNotes: row.admin_notes,
    approvedAt: row.approved_at,
    rejectedReason: row.rejected_reason,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

async function loadRow(db: D1Database, id: string): Promise<CustomerRow> {
  const row = await findCustomerById(db, id);
  if (!row) throw ApiError.notFound("Customer not found");
  return row;
}

/** Normalise + uniqueness-check a contact value for create/edit. */
async function resolveContact(
  env: Env,
  input: { email?: string | null; phone?: string | null },
  exceptId?: string,
): Promise<{ email: string | null; phone: string | null }> {
  const fields: Record<string, string> = {};
  let email: string | null = null;
  let phone: string | null = null;

  if (input.email !== undefined && input.email !== null && input.email.trim() !== "") {
    email = input.email.trim().toLowerCase();
    if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      fields.email = "Enter a valid email address";
    } else if (await identifierTaken(env.DB, "email", email, exceptId)) {
      fields.email = "That email is already in use";
    }
  }

  if (input.phone !== undefined && input.phone !== null && input.phone.trim() !== "") {
    phone = toE164(input.phone, env.DEFAULT_PHONE_COUNTRY);
    if (!phone) {
      fields.phone = "Enter a valid phone number";
    } else if (await identifierTaken(env.DB, "phone", phone, exceptId)) {
      fields.phone = "That phone number is already in use";
    }
  }

  if (Object.keys(fields).length) throw ApiError.validation(fields);
  return { email, phone };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** Status counts that drive the tab badges. */
async function statusCounts(db: D1Database) {
  const rows = await all<{ status: string; n: number }>(
    db,
    "SELECT status, COUNT(*) AS n FROM customers GROUP BY status",
  );
  const counts: Record<string, number> = { pending: 0, active: 0, rejected: 0, suspended: 0, deleted: 0 };
  let total = 0;
  for (const row of rows) {
    counts[row.status] = Number(row.n);
    total += Number(row.n);
  }
  return { ...counts, all: total };
}

/** GET /admin/customers?status=&q=&page=&limit= — the list behind the table. */
app.get("/", async (c) => {
  setNoStore(c);
  const q = c.req.query("q")?.trim() ?? "";
  const status = (c.req.query("status") ?? "all").toLowerCase();
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query("limit") ?? "50", 10) || 50));

  const where: string[] = [];
  const params: unknown[] = [];
  if (q) {
    where.push("(c.email LIKE ? OR c.phone_e164 LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.id = ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like, q);
  }
  if (status !== "all" && (LIST_STATUSES as readonly string[]).includes(status)) {
    where.push("c.status = ?");
    params.push(status);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [counts, total, rows] = await Promise.all([
    statusCounts(c.env.DB),
    count(c.env.DB, `SELECT COUNT(*) AS n FROM customers c ${clause}`, params),
    all<CustomerRow & { guest_order_matches: number }>(
      c.env.DB,
      `SELECT ${customerColumns("c")},
              (SELECT COUNT(*) FROM orders o
                WHERE o.customer_id IS NULL
                  AND ((c.email IS NOT NULL AND lower(o.email) = c.email)
                       OR (c.phone_e164 IS NOT NULL AND o.phone_e164 = c.phone_e164))) AS guest_order_matches
         FROM customers c ${clause}
        ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    ),
  ]);

  return ok(
    c,
    rows.map((row) => ({ ...present(row), guestOrderMatches: Number(row.guest_order_matches ?? 0) })),
    { total, page, pages: Math.max(1, Math.ceil(total / limit)), counts },
  );
});

/** GET /admin/customers/counts — the sidebar badge (polled). */
app.get("/counts", async (c) => {
  setNoStore(c);
  const [pending, openResetRequests] = await Promise.all([
    count(c.env.DB, "SELECT COUNT(*) AS n FROM customers WHERE status = 'pending'"),
    count(c.env.DB, "SELECT COUNT(*) AS n FROM password_reset_requests WHERE status = 'open'"),
  ]);
  return ok(c, { pending, openResetRequests });
});

/** GET /admin/customers/export.csv — the mailing list, without passwords. */
app.get("/export.csv", async (c) => {
  setNoStore(c);
  const rows = await all<{
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_e164: string | null;
    status: string;
    created_at: string;
    approved_at: string | null;
    orders: number;
    spent_cents: number;
  }>(
    c.env.DB,
    `SELECT c.first_name, c.last_name, c.email, c.phone_e164, c.status, c.created_at, c.approved_at,
            (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders,
            (SELECT COALESCE(SUM(o.total_cents), 0) FROM orders o WHERE o.customer_id = c.id) AS spent_cents
       FROM customers c WHERE c.status != 'deleted' ORDER BY c.created_at DESC LIMIT 5000`,
  );

  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Name", "Email", "Phone", "Status", "Created", "Approved", "Orders", "Total spent (cents)"].join(","),
    ...rows.map((row) =>
      [
        [row.first_name, row.last_name].filter(Boolean).join(" "),
        row.email,
        row.phone_e164,
        row.status,
        row.created_at,
        row.approved_at,
        row.orders,
        row.spent_cents,
      ]
        .map(escape)
        .join(","),
    ),
  ];

  c.header("Cache-Control", "no-store");
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="afreak-customers.csv"');
  return c.body(`\uFEFF${lines.join("\n")}\n`);
});

/** GET /admin/customers/:id — everything the detail page shows. */
app.get("/:id", async (c) => {
  setNoStore(c);
  const row = await loadRow(c.env.DB, c.req.param("id"));

  const [counts, orders, auditRows, sessions, openReset, subscription, guestOrderMatches] =
    await Promise.all([
      first<{ orders: number; spent_cents: number; last_order_at: string | null }>(
        c.env.DB,
        `SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS spent_cents,
                MAX(created_at) AS last_order_at
           FROM orders WHERE customer_id = ?`,
        [row.id],
      ),
      all<{ id: number; number: string; status: string; total_cents: number; created_at: string }>(
        c.env.DB,
        `SELECT id, number, status, total_cents, created_at FROM orders
          WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20`,
        [row.id],
      ),
      all<{ id: number; admin_id: string | null; action: string; detail_json: string | null; created_at: string }>(
        c.env.DB,
        `SELECT l.id, l.admin_id, l.action, l.detail_json, l.created_at, a.email AS admin_email
           FROM customer_audit_log l LEFT JOIN admins a ON a.id = l.admin_id
          WHERE l.customer_id = ? ORDER BY l.created_at DESC LIMIT 50`,
        [row.id],
      ),
      count(c.env.DB, "SELECT COUNT(*) AS n FROM customer_sessions WHERE customer_id = ?", [row.id]),
      first<{ id: number; created_at: string }>(
        c.env.DB,
        "SELECT id, created_at FROM password_reset_requests WHERE customer_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1",
        [row.id],
      ),
      row.email
        ? first<{ status: string; created_at: string }>(
            c.env.DB,
            "SELECT status, created_at FROM subscribers WHERE email = ?",
            [row.email],
          )
        : Promise.resolve(null),
      countGuestOrderMatches(c.env.DB, row.email, row.phone_e164),
    ]);

  return ok(c, {
    ...present(row),
    stats: {
      orders: Number(counts?.orders ?? 0),
      spentCents: Number(counts?.spent_cents ?? 0),
      lastOrderAt: counts?.last_order_at ?? null,
    },
    guestOrderMatches,
    openResetRequest: openReset ? { id: openReset.id, createdAt: openReset.created_at } : null,
    sessionsCount: Number(sessions),
    orders: orders.map((order) => ({
      id: order.id,
      number: order.number,
      status: order.status,
      totalCents: order.total_cents,
      createdAt: order.created_at,
    })),
    subscription: subscription ? { status: subscription.status, createdAt: subscription.created_at } : null,
    // Not built yet (account-dashboard spec); the page renders empty states.
    addresses: [],
    returns: [],
    audit: auditRows.map((entry) => ({
      id: entry.id,
      action: entry.action,
      adminEmail: (entry as unknown as { admin_email?: string | null }).admin_email ?? null,
      detail: entry.detail_json ? JSON.parse(entry.detail_json) : null,
      createdAt: entry.created_at,
    })),
  });
});

/* ------------------------------------------------------------------ *
 * Create
 * ------------------------------------------------------------------ */

const createSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().max(120).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  status: z.enum(["active", "pending"]).optional(),
  password: z.string().max(200).optional(),
  requirePasswordChange: z.boolean().optional(),
  linkGuestOrders: z.boolean().optional(),
  marketingOptIn: z.boolean().optional(),
});

/** POST /admin/customers — create an account, optionally with a generated password. */
app.post("/", async (c) => {
  setNoStore(c);
  const parsed = createSchema.safeParse(await readJsonWithLimit(c));
  if (!parsed.success) throw ApiError.validation(zodFields(parsed.error));
  const body = parsed.data;

  if (!body.email?.trim() && !body.phone?.trim()) {
    throw ApiError.validation({
      email: "Add an email address or a phone number",
      phone: "Add an email address or a phone number",
    });
  }

  const { email, phone } = await resolveContact(c.env, body);

  const status = body.status ?? "active";
  const requirePasswordChange = body.requirePasswordChange ?? true;

  let temporaryPassword: string | undefined;
  let password = body.password ?? "";
  if (!password) {
    temporaryPassword = generateTempPassword();
    password = temporaryPassword;
  } else {
    const problem = passwordProblem(password, { identifiers: [email, phone] });
    if (problem) throw ApiError.validation({ password: problem });
    temporaryPassword = password;
  }

  const { hash, salt } = await hashPassword(password);
  const id = newId("cus");
  const admin = c.get("admin");
  const approvedAt =
    status === "active" ? new Date().toISOString().replace("T", " ").slice(0, 19) : null;

  await run(
    c.env.DB,
    `INSERT INTO customers
       (id, email, phone_e164, first_name, last_name, password_hash, password_salt,
        must_change_password, status, signup_source, marketing_opt_in, approved_at, approved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?)`,
    [
      id,
      email,
      phone,
      cleanText(body.firstName, 120),
      cleanText(body.lastName ?? "", 120) || null,
      hash,
      salt,
      requirePasswordChange ? 1 : 0,
      status,
      body.marketingOptIn ? 1 : 0,
      approvedAt,
      status === "active" ? admin.id : null,
    ],
  );

  let linkedOrders = 0;
  if (body.linkGuestOrders) {
    linkedOrders = await linkGuestOrders(c.env.DB, id, email, phone);
  }

  await audit(c.env.DB, {
    customerId: id,
    adminId: admin.id,
    action: "create",
    detail: { status, linkedOrders },
  });

  return c.json(
    {
      data: {
        customer: present(await loadRow(c.env.DB, id)),
        ...(temporaryPassword ? { temporaryPassword } : {}),
        linkedOrders,
      },
    },
    201,
  );
});

/* ------------------------------------------------------------------ *
 * Status transitions
 * ------------------------------------------------------------------ */

const bulkSchema = z.object({ ids: z.array(z.string().trim().min(1).max(80)).min(1).max(100) });

/** POST /admin/customers/bulk-approve — approve a page of pending requests. */
app.post("/bulk-approve", async (c) => {
  setNoStore(c);
  const parsed = bulkSchema.safeParse(await readJsonWithLimit(c));
  if (!parsed.success) throw ApiError.validation(zodFields(parsed.error));

  const admin = c.get("admin");
  const statements: BatchStatement[] = [];
  let approved = 0;

  for (const id of parsed.data.ids) {
    const row = await findCustomerById(c.env.DB, id);
    if (!row || row.status !== "pending") continue;
    statements.push({
      sql: `UPDATE customers
               SET status = 'active', approved_at = datetime('now'), approved_by = ?,
                   rejected_reason = NULL, updated_at = datetime('now')
             WHERE id = ? AND status = 'pending'`,
      params: [admin.id, id],
    });
    statements.push({
      sql: `INSERT INTO customer_audit_log (customer_id, admin_id, action, detail_json)
            VALUES (?, ?, 'approve', ?)`,
      params: [id, admin.id, JSON.stringify({ bulk: true })],
    });
    approved += 1;
  }

  if (statements.length) await batch(c.env.DB, statements);

  return ok(c, { approved, skipped: parsed.data.ids.length - approved });
});

const approveSchema = z.object({
  linkGuestOrders: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

/** POST /admin/customers/:id/approve */
app.post("/:id/approve", async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  const row = await loadRow(c.env.DB, id);
  if (row.status !== "pending" && row.status !== "rejected") {
    throw ApiError.conflict("Only a pending or rejected request can be approved");
  }

  const parsed = approveSchema.safeParse(await readJsonWithLimit(c).catch(() => ({})));
  if (!parsed.success) throw ApiError.validation(zodFields(parsed.error));
  const admin = c.get("admin");

  await run(
    c.env.DB,
    `UPDATE customers
        SET status = 'active', approved_at = datetime('now'), approved_by = ?,
            rejected_reason = NULL, updated_at = datetime('now')
      WHERE id = ?`,
    [admin.id, id],
  );

  let linkedOrders = 0;
  if (parsed.data.linkGuestOrders) {
    linkedOrders = await linkGuestOrders(c.env.DB, id, row.email, row.phone_e164);
  }

  await audit(c.env.DB, {
    customerId: id,
    adminId: admin.id,
    action: "approve",
    detail: { linkedOrders, ...(parsed.data.note ? { note: cleanText(parsed.data.note, 500) } : {}) },
  });
  notifyApproved(customerFromRow({ ...row, status: "active" }));

  return ok(c, { customer: present(await loadRow(c.env.DB, id)), linkedOrders });
});

const rejectSchema = z.object({ reason: z.string().trim().max(500).optional() });

/** POST /admin/customers/:id/reject */
app.post("/:id/reject", async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  const row = await loadRow(c.env.DB, id);

  const parsed = rejectSchema.safeParse(await readJsonWithLimit(c).catch(() => ({})));
  if (!parsed.success) throw ApiError.validation(zodFields(parsed.error));

  const admin = c.get("admin");
  const reason = parsed.data.reason ? cleanText(parsed.data.reason, 500) : null;

  await run(
    c.env.DB,
    `UPDATE customers SET status = 'rejected', rejected_reason = ?, updated_at = datetime('now') WHERE id = ?`,
    [reason, id],
  );
  await revokeCustomerSessions(c.env.DB, id);
  await audit(c.env.DB, { customerId: id, adminId: admin.id, action: "reject", detail: { reason } });
  notifyRejected(customerFromRow({ ...row, status: "rejected" }), reason);

  return ok(c, { customer: present(await loadRow(c.env.DB, id)) });
});

/** POST /admin/customers/:id/suspend */
app.post("/:id/suspend", async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  await loadRow(c.env.DB, id);

  await run(
    c.env.DB,
    "UPDATE customers SET status = 'suspended', updated_at = datetime('now') WHERE id = ?",
    [id],
  );
  await revokeCustomerSessions(c.env.DB, id);
  await audit(c.env.DB, { customerId: id, adminId: c.get("admin").id, action: "suspend" });

  return ok(c, { customer: present(await loadRow(c.env.DB, id)) });
});

/** POST /admin/customers/:id/unsuspend */
app.post("/:id/unsuspend", async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  await loadRow(c.env.DB, id);

  await run(
    c.env.DB,
    "UPDATE customers SET status = 'active', updated_at = datetime('now') WHERE id = ?",
    [id],
  );
  await audit(c.env.DB, { customerId: id, adminId: c.get("admin").id, action: "unsuspend" });

  return ok(c, { customer: present(await loadRow(c.env.DB, id)) });
});

/* ------------------------------------------------------------------ *
 * Password
 * ------------------------------------------------------------------ */

const resetSchema = z.object({
  mode: z.enum(["generate", "set"]).optional(),
  password: z.string().max(200).optional(),
  requirePasswordChange: z.boolean().optional(),
});

/** POST /admin/customers/:id/reset-password — the only way back in for a locked-out customer. */
app.post("/:id/reset-password", async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  const row = await loadRow(c.env.DB, id);

  const parsed = resetSchema.safeParse(await readJsonWithLimit(c).catch(() => ({})));
  if (!parsed.success) throw ApiError.validation(zodFields(parsed.error));
  const mode = parsed.data.mode ?? "generate";
  const requirePasswordChange = parsed.data.requirePasswordChange ?? true;

  let temporaryPassword: string;
  if (mode === "set") {
    if (!parsed.data.password) throw ApiError.validation({ password: "Enter the new password" });
    assertPassword(parsed.data.password, { identifiers: [row.email, row.phone_e164] });
    temporaryPassword = parsed.data.password;
  } else {
    temporaryPassword = generateTempPassword();
  }

  const { hash, salt } = await hashPassword(temporaryPassword);
  const admin = c.get("admin");

  await batch(c.env.DB, [
    {
      sql: `UPDATE customers
               SET password_hash = ?, password_salt = ?, must_change_password = ?,
                   password_changed_at = NULL, updated_at = datetime('now')
             WHERE id = ?`,
      params: [hash, salt, requirePasswordChange ? 1 : 0, id],
    },
    { sql: "DELETE FROM customer_sessions WHERE customer_id = ?", params: [id] },
    {
      sql: `UPDATE password_reset_requests
               SET status = 'resolved', resolved_at = datetime('now'), resolved_by = ?
             WHERE customer_id = ? AND status = 'open'`,
      params: [admin.id, id],
    },
  ]);

  await audit(c.env.DB, {
    customerId: id,
    adminId: admin.id,
    action: "reset_password",
    detail: { mode, requirePasswordChange },
  });

  return ok(c, { customer: present(await loadRow(c.env.DB, id)), temporaryPassword });
});

/* ------------------------------------------------------------------ *
 * Edit, link, delete
 * ------------------------------------------------------------------ */

const patchSchema = z.object({
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  email: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  adminNotes: z.string().trim().max(2000).nullable().optional(),
  marketingOptIn: z.boolean().optional(),
});

/** PATCH /admin/customers/:id — contact details and notes. */
app.patch("/:id", async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  const row = await loadRow(c.env.DB, id);

  const parsed = patchSchema.safeParse(await readJsonWithLimit(c));
  if (!parsed.success) throw ApiError.validation(zodFields(parsed.error));
  const body = parsed.data;

  const contact =
    body.email !== undefined || body.phone !== undefined
      ? await resolveContact(c.env, body, id)
      : { email: row.email, phone: row.phone_e164 };

  const sets: string[] = [];
  const params: unknown[] = [];
  const changed: Record<string, { from: unknown; to: unknown }> = {};

  if (body.firstName !== undefined) {
    sets.push("first_name = ?");
    params.push(cleanText(body.firstName, 120));
    changed.firstName = { from: row.first_name, to: body.firstName };
  }
  if (body.lastName !== undefined) {
    sets.push("last_name = ?");
    params.push(cleanText(body.lastName, 120) || null);
    changed.lastName = { from: row.last_name, to: body.lastName };
  }
  if (body.email !== undefined) {
    sets.push("email = ?");
    params.push(contact.email);
    if (contact.email !== row.email) changed.email = { from: row.email, to: contact.email };
  }
  if (body.phone !== undefined) {
    sets.push("phone_e164 = ?");
    params.push(contact.phone);
    if (contact.phone !== row.phone_e164) changed.phone = { from: row.phone_e164, to: contact.phone };
  }
  if (body.adminNotes !== undefined) {
    sets.push("admin_notes = ?");
    params.push(body.adminNotes ? cleanText(body.adminNotes, 2000) : null);
  }
  if (body.marketingOptIn !== undefined) {
    sets.push("marketing_opt_in = ?");
    params.push(body.marketingOptIn ? 1 : 0);
    changed.marketingOptIn = { from: row.marketing_opt_in === 1, to: body.marketingOptIn };
  }

  if (!sets.length) throw ApiError.validation({ _: "Nothing to update" });

  await run(
    c.env.DB,
    `UPDATE customers SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    [...params, id],
  );

  await audit(c.env.DB, {
    customerId: id,
    adminId: c.get("admin").id,
    action: "edit",
    detail: { fields: Object.keys(changed) },
  });

  return ok(c, { customer: present(await loadRow(c.env.DB, id)) });
});

/** POST /admin/customers/:id/link-orders — adopt matching guest orders, by hand. */
app.post("/:id/link-orders", async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  const row = await loadRow(c.env.DB, id);

  const linked = await linkGuestOrders(c.env.DB, id, row.email, row.phone_e164);
  await audit(c.env.DB, { customerId: id, adminId: c.get("admin").id, action: "link_orders", detail: { linked } });

  return ok(c, { linked });
});

/** DELETE /admin/customers/:id — owner only, typed confirmation. */
app.delete("/:id", requireOwner, async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  await loadRow(c.env.DB, id);

  if (c.req.query("confirm") !== "true") {
    throw ApiError.badRequest('Deleting an account requires confirm=true');
  }

  await anonymizeCustomer(c.env.DB, id, c.get("admin").id);

  return ok(c, { deleted: true });
});

export default app;
