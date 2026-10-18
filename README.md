# AFREAK — Backend + CMS

Cloudflare Pages project that serves three things from one deployment:

| Surface      | Served by                                   | Path                          |
| ------------ | ------------------------------------------- | ----------------------------- |
| JSON API     | Hono, running as a Pages Function           | `/api/*`                      |
| Media        | Cloudflare R2 via a Pages Function          | `/media/*`                    |
| Admin CMS    | React SPA (Vite build, static assets)       | `/admin`                      |

Binding config lives in `wrangler.toml` (D1 `DB`, R2 `MEDIA`). The API claims
`/api/*` and `/media/*` through `public/_routes.json`; everything else is served
as a static asset, and unmatched paths fall back to `index.html` so the CMS SPA
can own client-side routes.

> The storefront lives in a sibling project. Point it at this API with
> `VITE_API_BASE` (empty string = same origin).

---

## Requirements

- Node.js 20+
- A Cloudflare account (for `wrangler login`)
- `wrangler` is installed as a dev dependency, so use `npx wrangler …`

---

## First-time setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the Cloudflare resources

```bash
npx wrangler login
npx wrangler d1 create afreak-db
npx wrangler r2 bucket create afreak-products
```

Copy the `database_id` printed by `d1 create` into `wrangler.toml`, replacing
`REPLACE_WITH_D1_ID`.

### 3. Set secrets

Local development reads `.dev.vars`:

```ini
SESSION_SECRET=<at least 32 random characters>
SETUP_TOKEN=<one-time token used to create the first owner account>
CLERK_WEBHOOK_SECRET=<whsec_… from the Clerk webhook endpoint>
```

For the deployed site add the same values as encrypted secrets:

```bash
npx wrangler pages secret put SESSION_SECRET
npx wrangler pages secret put SETUP_TOKEN
npx wrangler pages secret put CLERK_WEBHOOK_SECRET
```

`SETUP_TOKEN` only needs to exist until the first owner account is created —
`POST /api/admin/setup` permanently disables itself once any admin exists.

`CLERK_WEBHOOK_SECRET` is issued by Clerk when you add the webhook endpoint —
see [Customer accounts](#customer-accounts-clerk). Until it is set,
`POST /api/webhooks/clerk` answers `401` and no customers are synced.

### 4. Apply migrations

```bash
# local
npm run db:migrate:local

# production
npm run db:migrate:remote
```

`migrations/` holds schema only. Sample data lives in `seeds/0002_seed.sql`
and is **dev/staging only** — it is deliberately kept outside `migrations/` so
that `wrangler d1 migrations apply` can never push demo products, reviews or
promo codes to production.

```bash
npm run db:seed:local    # load the sample data into the local database
npm run db:seed:remote   # only if you really want demo data in production
```

### 5. Create the first admin

Open `/admin` and use the first-run form (email, password, setup token).
Alternatively:

```bash
curl -X POST https://<your-site>/api/admin/setup \
  -H 'content-type: application/json' \
  -H 'X-Setup-Token: <SETUP_TOKEN>' \
  -d '{"email":"you@example.com","password":"at-least-10-chars","name":"Owner"}'
```

---

## Development

```bash
npm run dev      # Vite dev server for the CMS SPA (proxying is not set up)
npm run build    # produce dist/ (CMS SPA + functions)
npm run cf:dev   # build, then `wrangler pages dev dist`
```

`npm run cf:dev` is the realistic local target: it runs the Hono API, the R2
media handler and the built SPA together against local D1/R2 state under
`.wrangler/state`. To pin a port:

```bash
npm run build
npx wrangler pages dev dist --port 8788 --ip 127.0.0.1
```

Local data persists in `.wrangler/state/v3`. Delete that folder to start over.

## Type checking

```bash
npm run typecheck   # tsc --noEmit over functions/, server/, shared/
```

The CMS SPA is plain JSX and is not covered by `typecheck`.

---

## Deployment

```bash
npm run deploy   # build + `wrangler pages deploy dist --project-name afreakcms`
```

Remember to run `npx wrangler d1 migrations apply afreak-db --remote` after
deploying schema changes.

---

## Environment variables

`wrangler.toml` `[vars]`:

| Variable                       | Default                | Purpose                              |
| ------------------------------ | ---------------------- | ------------------------------------ |
| `SITE_URL`                     | `https://afreak.pages.dev` | Canonical origin, used in emails  |
| `CURRENCY`                     | `EUR`                  | Currency code returned with money    |
| `FREE_SHIPPING_THRESHOLD_CENTS`| `15000`                | Fallback if the `shipping` setting is unset |
| `FLAT_SHIPPING_CENTS`          | `600`                  | Fallback flat rate                   |
| `EXPRESS_SHIPPING_CENTS`       | `1200`                 | Fallback express rate                |

Secrets (via `.dev.vars` locally, `wrangler pages secret put` in production):

| Secret                 | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `SESSION_SECRET`       | HMAC key for admin session cookies                   |
| `SETUP_TOKEN`          | Gate for the one-time owner creation route           |
| `CLERK_WEBHOOK_SECRET` | Verifies Clerk/Svix signatures on `/api/webhooks/clerk` |

Shipping rates, store details, promo bar, hero slides and similar content are
edited in `/admin` and stored in D1 (`settings` table), overriding the
fallbacks above.

Storefront build-time variables (set in the storefront project):

| Variable                  | Purpose                                        |
| ------------------------- | ---------------------------------------------- |
| `VITE_API_BASE`           | Origin of this API; empty = same origin        |
| `VITE_TURNSTILE_SITE_KEY` | Optional Turnstile site key for public forms   |

---

## API overview

Public (all under `/api`):

- `GET /health`
- `GET /categories`, `GET /products`, `GET /products/:slug`
- `GET /products/:slug/reviews`, `POST /products/:slug/reviews`
- `GET /search`, `GET /home`, `GET /settings/public`
- `POST /checkout/quote`, `POST /promo/validate`
- `POST /orders`, `GET /orders/:number` (email-gated lookup)
- `POST /forms/:type` (`contact`, `custom_print`, `notify_me`)
- `POST /subscribers`
- `POST /track`

Admin (all under `/api/admin`, session cookie required except auth routes):

- `GET /me`, `POST /setup`, `POST /login`, `POST /logout`, `POST /password`
- `GET /dashboard?range=7d|30d|90d`
- CRUD for `products` (plus `bulk`, `duplicate`), `categories` (+ `reorder`),
  `orders` (+ `export.csv`), `promos`, `reviews`, `submissions`
  (+ `export.csv`), `subscribers` (+ `export.csv`), `media`, `content`,
  `settings/:key`, `users`
- `GET /artwork/:key` — streams private custom-print artwork

Artist uploads live under the `artwork/` prefix in R2 and are **never**
reachable through `/media/*`; they are only streamed by the admin-only
artwork route.

---

## Project layout

```
functions/            Cloudflare Pages Functions (entry points)
  api/[[route]].ts      Hono app for /api/*
  media/[[path]].ts     R2 streaming for /media/*
server/               Application code (TypeScript)
  app.ts                Route mounting
  env.ts                Bindings + variables typing
  lib/                  db, http, session, password, money, settings, ids…
  middleware/           auth, rate limiting, cache headers
  routes/public/        Storefront-facing endpoints
  routes/admin/         CMS endpoints
migrations/           D1 schema (production-safe)
seeds/                Sample data for local/staging only
public/               Static passthrough (_headers, _routes.json, icons)
src/                  Admin CMS SPA (React + Tailwind v4)
  admin/                Screens: Dashboard, Products, Media, Orders, …
  components/ui.jsx     Shared primitives (Button, Table, Modal, Toast…)
  hooks/                React Query hooks (auth + storefront)
  lib/                  fetch wrapper, formatters, image upload
```

---

## Notes on behaviour

- **Money** is stored and transported as integer cents everywhere. The CMS
  converts to euros only in form inputs.
- **SQL** is always parameterised (prepared statements); no string-built
  queries.
- **CORS** is not wildcard — only `SITE_URL` is allowed.
- **Admin responses** are `Cache-Control: no-store`; `/admin/*` is also
  `X-Robots-Tag: noindex, nofollow`.
- **Passwords** use PBKDF2 (100k iterations) with a per-user salt.
- **Publishing validation** — a product must have at least one image before its
  status can become `published`.
- **Idempotency** — order creation accepts an idempotency key and replays the
  original result instead of double-charging stock.
- Media uploads are resized to ≤2000px and re-encoded to WebP in the browser
  before they are sent to the API.
