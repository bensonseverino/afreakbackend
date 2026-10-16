import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { all, count, first, run } from "../../lib/db";
import { ApiError, ok } from "../../lib/http";
import { parseJson, cleanText } from "../../lib/validate";
import { PASSWORD_MIN_LENGTH, hashPassword } from "../../lib/password";
import { newId } from "../../lib/ids";
import { destroyAllSessions } from "../../lib/session";
import { requireOwner } from "../../middleware/auth";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

// Every route here is owner-only.
app.use("*", requireOwner);

/** GET /admin/users */
app.get("/", async (c) => {
  setNoStore(c);
  const rows = await all<{ id: string; email: string; name: string | null; role: string; created_at: string }>(
    c.env.DB,
    "SELECT id, email, name, role, created_at FROM admins ORDER BY created_at",
  );
  return ok(c, rows);
});

/** POST /admin/users — add an editor (or another owner). */
app.post("/", async (c) => {
  setNoStore(c);
  const body = await parseJson(
    c,
    z.object({
      email: z.string().trim().toLowerCase().email().max(200),
      password: z.string().min(PASSWORD_MIN_LENGTH).max(200),
      name: z.string().trim().max(120).optional(),
      role: z.enum(["owner", "editor"]).default("editor"),
    }),
  );

  const clash = await first(c.env.DB, "SELECT id FROM admins WHERE email = ?", [body.email]);
  if (clash) throw ApiError.validation({ email: "An account with this email already exists" });

  const { hash, salt } = await hashPassword(body.password);
  const id = newId("adm");
  await run(
    c.env.DB,
    `INSERT INTO admins (id, email, name, role, password_hash, salt) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, body.email, body.name ? cleanText(body.name, 120) : null, body.role, hash, salt],
  );
  return ok(c, { id, email: body.email, role: body.role });
});

/** DELETE /admin/users/:id */
app.delete("/:id", async (c) => {
  setNoStore(c);
  const id = c.req.param("id");
  const me = c.get("admin");
  if (id === me.id) throw ApiError.badRequest("You cannot delete your own account");

  const target = await first<{ role: string }>(c.env.DB, "SELECT role FROM admins WHERE id = ?", [id]);
  if (!target) throw ApiError.notFound("User not found");

  if (target.role === "owner") {
    const owners = await count(c.env.DB, "SELECT COUNT(*) AS n FROM admins WHERE role = 'owner'");
    if (owners <= 1) throw ApiError.badRequest("At least one owner must remain");
  }

  await destroyAllSessions(c.env, id);
  await run(c.env.DB, "DELETE FROM admins WHERE id = ?", [id]);
  return ok(c, { deleted: true });
});

export default app;
