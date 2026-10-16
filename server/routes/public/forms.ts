import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { run } from "../../lib/db";
import { ok } from "../../lib/http";
import { parseJson, cleanText } from "../../lib/validate";
import { verifyTurnstile } from "../../lib/turnstile";
import { clientIp, rateLimit } from "../../middleware/rateLimit";
import { setNoStore } from "../../middleware/cache";

const app = new Hono<AppEnv>();

const emailSchema = z.string().trim().toLowerCase().email().max(200);
const honeypot = z.string().max(200).optional();

/** Honeypot + Turnstile. Returns false when the request should be silently accepted. */
async function passesSpamChecks(
  c: Parameters<typeof clientIp>[0],
  body: { website?: string; turnstileToken?: string },
): Promise<boolean> {
  if (body.website) return false; // bot filled the hidden field
  const valid = await verifyTurnstile(c.env, body.turnstileToken, clientIp(c));
  return valid;
}

// --- Contact ---------------------------------------------------------------
const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  subject: z.string().trim().max(160).optional(),
  message: z.string().trim().min(1).max(5000),
  website: honeypot,
  turnstileToken: z.string().max(2000).optional(),
});

app.post("/contact", rateLimit({ scope: "contact", limit: 5, windowMs: 10 * 60_000 }), async (c) => {
  setNoStore(c);
  const body = await parseJson(c, contactSchema);
  if (!(await passesSpamChecks(c, body))) return ok(c, { received: true });

  await run(
    c.env.DB,
    `INSERT INTO submissions (type, name, email, subject, message, payload_json)
     VALUES ('contact', ?, ?, ?, ?, '{}')`,
    [
      cleanText(body.name, 120),
      body.email,
      body.subject ? cleanText(body.subject, 160) : null,
      cleanText(body.message, 5000),
    ],
  );
  return ok(c, { received: true });
});

// --- Newsletter ------------------------------------------------------------
const newsletterSchema = z.object({
  email: emailSchema,
  source: z.string().trim().max(80).optional(),
  website: honeypot,
  turnstileToken: z.string().max(2000).optional(),
});

app.post(
  "/newsletter",
  rateLimit({ scope: "newsletter", limit: 10, windowMs: 10 * 60_000 }),
  async (c) => {
    setNoStore(c);
    const body = await parseJson(c, newsletterSchema);
    if (!(await passesSpamChecks(c, body))) return ok(c, { subscribed: true });

    // Idempotent: re-subscribing simply reactivates.
    await run(
      c.env.DB,
      `INSERT INTO subscribers (email, source, status) VALUES (?, ?, 'active')
       ON CONFLICT(email) DO UPDATE SET status = 'active'`,
      [body.email, body.source ? cleanText(body.source, 80) : null],
    );
    return ok(c, { subscribed: true });
  },
);

// --- Notify me (sold-out size) --------------------------------------------
const notifySchema = z.object({
  email: emailSchema,
  productId: z.coerce.number().int().positive(),
  color: z.string().trim().max(60).optional(),
  size: z.string().trim().max(30).optional(),
  website: honeypot,
  turnstileToken: z.string().max(2000).optional(),
});

app.post(
  "/notify-me",
  rateLimit({ scope: "notify", limit: 10, windowMs: 10 * 60_000 }),
  async (c) => {
    setNoStore(c);
    const body = await parseJson(c, notifySchema);
    if (!(await passesSpamChecks(c, body))) return ok(c, { received: true });

    await run(
      c.env.DB,
      `INSERT INTO submissions (type, email, payload_json) VALUES ('notify_me', ?, ?)`,
      [
        body.email,
        JSON.stringify({
          productId: body.productId,
          color: body.color ?? null,
          size: body.size ?? null,
        }),
      ],
    );
    return ok(c, { received: true });
  },
);

// --- Custom print (quote request) -----------------------------------------
const customPrintSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  description: z.string().trim().min(1).max(5000),
  productId: z.coerce.number().int().positive().optional(),
  placement: z.string().trim().max(60).optional(),
  artworkKey: z.string().trim().max(300).optional(),
  website: honeypot,
  turnstileToken: z.string().max(2000).optional(),
});

app.post(
  "/custom-print",
  rateLimit({ scope: "custom-print", limit: 5, windowMs: 10 * 60_000 }),
  async (c) => {
    setNoStore(c);
    const body = await parseJson(c, customPrintSchema);
    if (!(await passesSpamChecks(c, body))) return ok(c, { received: true });

    await run(
      c.env.DB,
      `INSERT INTO submissions (type, name, email, message, payload_json)
       VALUES ('custom_print', ?, ?, ?, ?)`,
      [
        cleanText(body.name, 120),
        body.email,
        cleanText(body.description, 5000),
        JSON.stringify({
          productId: body.productId ?? null,
          placement: body.placement ?? null,
          artworkKey: body.artworkKey ?? null,
        }),
      ],
    );
    return ok(c, { received: true });
  },
);

export default app;
