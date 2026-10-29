# CMS Connection Audit — AFREAK Storefront

## 1. Summary

- The CMS connection is now consistent end-to-end: every storefront CMS section reads from one API shape, the admin saves through the same keys, and every break would now be loud (error state, debug fallback badge, or a diagnostic red flag) instead of silently falling back to default copy.
- Root cause of the reported symptom ("CMS content not showing on the storefront"): the homepage components were previously rendering hard-coded default hero/lookbook copy instead of reading from `GET /api/home`. That code path is gone. The storefront now always requests the live homepage payload and only falls back to defaults when the API explicitly returns an empty set for a brand-new store. When the API errors, the affected sections show an error state with a retry button.
- Primary safeguards added so this cannot silently regress:
  - Homepage content is served from a single endpoint (`GET /home`) and cached with `no-store` + an ETag derived from `content_version`, so browsers revalidate and the storefront never serves stale CMS content.
  - `content_version` is bumped inside the same D1 batch as every admin write that can change the storefront, so a save and its "now revalidate" signal are atomic.
  - A diagnostics page exposes the exact queries and row counts the storefront reads, and compares the admin's view with the storefront's view.
  - Fallback content is concentrated in one file (`src/data/defaults.js`) and only renders when the API returns empty, never on error; on `?debug=1` (and in dev) a `FALLBACK CONTENT:` badge makes any fallback visible.
  - The admin CMS posts `?` after every save and re-checks the live site, so a save that did not make it to the storefront is surfaced as a toast rather than assumed successful.

## 2. Diagnostic procedure followed (Part A)

- Traced the full connection chain for the two reported symptoms:
  - Hero slides "BUILT FOR THE IN-BETWEEN", "ICONIC AFRICAN MAP TOTE", "SOUTH SUDAN PEACE SIGN FRAME".
  - Lookbook (4) tiles.
- Followed the chain link by link: admin UI save → D1 row → public API response → storefront fetch → homepage component → rendered DOM.
- For each CMS-driven storefront section, identified the exact link that had been disconnected and the concrete symptom it would produce.
- Checked the homepage components against `GET /home` and the lookbook page against `GET /lookbook`.
- Checked that the public API and the admin CMS agree on the same D1 tables, the same column names, and the same serialization contract (camelCase, normalized image shape, arrays not null).

## 3. Root cause

Two related breaks, both on the storefront side of link ④/⑤:

1. The homepage was not reading live CMS hero/lookbook content. The hero and homepage lookbook components had been rendering their own hard-coded default slides/tiles, so even when the admin CMS and D1 held real content the homepage never asked the API for it and never rendered the CMS rows.

2. Because those sections defaulted to static copy, a broken or empty CMS connection was invisible: the homepage kept showing plausible default copy instead of surfacing the missing content as an error or a clearly-marked fallback.

The admin CMS, D1, and public API already agreed on the content. The break was that the storefront homepage was not using that API path at all for the two reported sections.

## 4. Section-by-section connection status

Status key:
- Connected: the storefront section currently reads from the intended CMS-backed API path, with an explicit error state and a fallback path only for the "brand-new empty store" case.
- Was disconnected: the section was previously not reading the intended CMS path; fixed in this pass.
- Already sensible: the section already used the intended CMS-backed path before this pass.

### Homepage (`/`)

| Section | Path | Status |
|---|---|---|
| Hero carousel | `GET /home → heroSlides` | Was disconnected → connected. Component now renders `home?.heroSlides`; defaults only for a new store; error state on API failure. |
| Lookbook strip (first 4) | `GET /home → lookbook` | Was disconnected → connected. Component now renders `home?.lookbook`; defaults only for a new store; error state on API failure. |
| Featured products | `GET /home → featured` | Already sensible. |
| New arrivals | `GET /home → newArrivals` (+ filler from featured) | Already sensible. |
| Product showcase | `GET /home → showcase` | Already sensible. |
| Shipping banner | `GET /home → shippingBanner` + `GET /settings/public → shipping.thresholdCents` | Already sensible. |
| Footer (blurb/social/store name) | `GET /home → footer` + `GET /settings/public → store/footer` | Already sensible. |
| Promo bar (announcement) | `GET /home → promoBar` (active flag + text) | Already sensible. |

### Full lookbook page (`/lookbook`)

| Section | Path | Status |
|---|---|---|
| Lookbook tiles | `GET /lookbook` | Already sensible. |

### Menu / header chrome

| Section | Path | Status |
|---|---|---|
| Mobile menu feature tile | `GET /settings/public → menuFeature` | Already sensible. |
| Menu footer free-shipping note | `GET /settings/public → shipping.thresholdCents` | Already sensible. |
| Header store name | `GET /settings/public → store.name` | Already sensible. |
| Currency switcher / segmented control | Local currency state, not a CMS content module | Not a CMS content disconnect. |
| Nav links / accordion labels | Static config (`src/config/nav.js`) | Not a CMS content disconnect. |

### Account, cart, checkout, PDP, shop, legal, forms, tracking, geo, promo, rates, uploads

These are commerce/feature surfaces, not homepage CMS content modules. They were not the reported break and are out of scope for a homepage CMS audit. They were not changed in this pass.

## 5. Safeguards added

### 5.1 Single source of truth for homepage content

`GET /home` is now the single endpoint for every CMS-driven homepage section. Homepage components no longer own their own content queries for hero, lookbook, promo bar, shipping banner, showcase, featured, new arrivals, footer, or menu feature tile.

### 5.2 Revalidation semantics

Public content endpoints set `Cache-Control: no-store` and an `ETag` derived from `content_version`. The storefront revalidates on focus and reconnect and treats content as stale after a short window, so an admin save is surfaced to the storefront quickly without relying on the CMS copy landing first.

### 5.3 Version the content, not each section

`content_version` is one integer in `settings`. Every admin write that can change the storefront bumps it in the same batch as the write, so a save and its revalidation signal are atomic and the storefront can never see a write that has not been announced.

### 5.4 Fallback content is local and loud

Default hero/lookbook/showcase/settings content lives only in `src/data/defaults.js`. It is used only when the API returns an empty set for a new store. When the API errors, the affected sections show an error state, not default copy. On `?debug=1` (and in development) any fallback renders a `FALLBACK CONTENT:` badge and the console warns which section fell back and why.

### 5.5 Diagnostics

A diagnostics surface exposes the same hero/lookbook queries the storefront uses, with row counts, and compares the admin's view with the storefront's view. A CMS save that does not make it to the storefront is surfaced as a live-check result in the admin UI.

### 5.6 Admin save confirmation

The admin CMS re-fetches the relevant public endpoint after each save and reports whether the content is actually visible on the site. A save that succeeds against the admin API but does not appear on the storefront is reported as "SAVED — NOT VISIBLE ON SITE" rather than silently assumed successful.

## 6. Exact break locations (what was disconnected)

1. Homepage hero component: was rendering its own hard-coded default slides instead of `home.heroSlides` from `GET /home`.
2. Homepage lookbook component: was rendering its own hard-coded default lookbook tiles instead of `home.lookbook` from `GET /home`.

Both are now driven by the same homepage query the rest of the homepage already used.

## 7. What was not the problem (eliminated)

- Admin CMS save path: the admin content endpoints write hero slides and lookbook items into the expected tables with the expected columns and active flag.
- D1 schema: the public `GET /home` and `GET /lookbook` queries and the admin diagnostics query read the same `hero_slides` / `lookbook_items` tables joined to `media` the same way.
- Serialization contract: the public API normalizes rows into camelCase with a consistent `{ url, alt, width, height }` image shape; the storefront mappers expect that shape.
- Lookbook page: already used `GET /lookbook` before this pass; the reported homepage symptom did not originate there.
- Currency/header/menu link config: these are not homepage CMS content modules.

## 8. Remaining verification

Before treating the fix as proven, verify on the live/production origin, not only locally:

1. Sign in to the admin CMS, confirm the reported hero slides exist and are live.
2. Reload the homepage on the storefront origin and confirm the three named slides appear in the hero carousel in CMS order.
3. Confirm the homepage lookbook strip shows the CMS tiles, not the default tiles.
4. Confirm the full `/lookbook` page shows the CMS lookbook items.
5. On `?debug=1`, confirm no `FALLBACK CONTENT:` badge appears for hero or lookbook when the CMS has content.
6. Save a change in the admin CMS and confirm it appears on the storefront without a manual reload being required (or within the revalidation window).
7. Stop the API (or disconnect the storefront from the real origin) and confirm hero/lookbook show an explicit error state with retry, not default copy.

## 9. How to keep this from regressing

- Any new homepage CMS section must be added to `GET /home`, to the homepage query mapper in `src/lib/catalog.js`, and to the relevant homepage component. Do not let a homepage component invent its own content endpoint.
- Any new admin content table must have a matching public query and serializer; the diagnostics page should compare it.
- A homepage component must never silently fall back to static copy on API error; error should render an error state.
- If a setting key is added, add it to the shared settings keys file so the admin and public paths cannot drift.
- Use `npm run check:cms` against staging/production before treating a content change as shipped.

## 10. Notes

- This report tracks the CMS ↔ storefront connection for the homepage and lookbook surfaces that were in scope for the reported symptom. It is not a full commerce audit of cart/checkout/account/PDP/shop/legal.
- Fallback copy in `src/data/defaults.js` is intentional and still required for a brand-new store with no CMS content yet; it is not the bug. The bug was that the homepage treated that fallback as its primary content source.
