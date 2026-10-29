#!/usr/bin/env node
/**
 * One-off EUR -> KES (or any base -> store currency) price conversion.
 *
 *   node scripts/convert-prices.mjs --rate 130 --dry-run
 *   node scripts/convert-prices.mjs --rate 130
 *   node scripts/convert-prices.mjs --rate 130 --remote --round 50
 *
 * Existing amounts are never converted automatically by the app: run this
 * deliberately, or re-enter prices in the admin. Products, variant prices,
 * fixed-amount promo codes and the shipping settings are converted.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const rate = Number(value("--rate", "0"));
const round = Math.max(1, Number(value("--round", "10")) || 10);
const dryRun = flag("--dry-run");
const remote = flag("--remote");
const target = remote ? "--remote" : "--local";

if (!Number.isFinite(rate) || rate <= 0) {
  console.error("Usage: node scripts/convert-prices.mjs --rate <target per base> [--round 10] [--dry-run] [--remote]");
  process.exit(1);
}

const convert = (minor) =>
  minor == null ? null : Math.max(0, Math.round((Number(minor) * rate) / round) * round);
const quote = (input) => `'${String(input).replace(/'/g, "''")}'`;

const dir = mkdtempSync(join(tmpdir(), "afreak-convert-"));

function runFile(sql, capture = false) {
  const file = join(dir, `${capture ? "query" : "update"}.sql`);
  writeFileSync(file, sql, "utf8");
  return execSync(`npx wrangler d1 execute afreak-db ${target} --json --file "${file}"`, {
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

try {
  const out = runFile(
    `SELECT id, slug, price_cents, old_price_cents FROM products ORDER BY id;
SELECT id, product_id, price_cents, compare_at_price_cents FROM product_variants ORDER BY id;
SELECT code, type, value, min_subtotal_cents FROM promo_codes WHERE type = 'fixed' OR min_subtotal_cents > 0;
SELECT value_json FROM settings WHERE key = 'shipping';`,
    true,
  );
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  const [products = [], variants = [], promos = [], shippingRows = []] = parsed.map(
    (entry) => entry.results ?? [],
  );

  const updates = [];

  for (const p of products) {
    const price = convert(p.price_cents);
    let old = convert(p.old_price_cents);
    if (old != null && old <= price) old = price + round;
    updates.push({
      label: `product ${p.slug}`,
      before: `${p.price_cents} / ${p.old_price_cents ?? "—"}`,
      after: `${price} / ${old ?? "—"}`,
      sql: `UPDATE products SET price_cents = ${price}, old_price_cents = ${old ?? "NULL"} WHERE id = ${p.id};`,
    });
  }

  for (const v of variants) {
    if (v.price_cents == null && v.compare_at_price_cents == null) continue;
    const price = convert(v.price_cents);
    let old = convert(v.compare_at_price_cents);
    if (old != null && price != null && old <= price) old = price + round;
    updates.push({
      label: `variant #${v.id}`,
      before: `${v.price_cents ?? "—"} / ${v.compare_at_price_cents ?? "—"}`,
      after: `${price ?? "—"} / ${old ?? "—"}`,
      sql: `UPDATE product_variants SET price_cents = ${price ?? "NULL"}, compare_at_price_cents = ${old ?? "NULL"} WHERE id = ${v.id};`,
    });
  }

  for (const promo of promos) {
    const fixed = promo.type === "fixed" ? convert(promo.value) : promo.value;
    const min = convert(promo.min_subtotal_cents);
    updates.push({
      label: `promo ${promo.code}`,
      before: `${promo.value} / ${promo.min_subtotal_cents}`,
      after: `${fixed} / ${min}`,
      sql: `UPDATE promo_codes SET value = ${Number(fixed)}, min_subtotal_cents = ${Number(min)} WHERE code = ${quote(promo.code)};`,
    });
  }

  if (shippingRows[0]) {
    const shipping = JSON.parse(shippingRows[0].value_json);
    const next = {
      ...shipping,
      threshold_cents: convert(shipping.threshold_cents),
      flat_cents: convert(shipping.flat_cents),
      express_cents: convert(shipping.express_cents),
    };
    updates.push({
      label: "shipping setting",
      before: JSON.stringify(shipping),
      after: JSON.stringify(next),
      sql: `UPDATE settings SET value_json = ${quote(JSON.stringify(next))}, updated_at = datetime('now') WHERE key = 'shipping';`,
    });
  }

  if (dryRun) {
    console.log(`Rate ${rate} ${remote ? "(remote)" : "(local)"}, rounded to ${round}:\n`);
    for (const row of updates) {
      console.log(`${row.label.padEnd(32)} ${row.before.padEnd(24)} -> ${row.after}`);
    }
    console.log(`\n${updates.length} row(s) would change. Re-run without --dry-run to apply.`);
    process.exit(0);
  }

  const RANGE_SQL = `
UPDATE products SET
  price_from_cents = COALESCE(
    (SELECT MIN(COALESCE(v.price_cents, products.price_cents)) FROM product_variants v
      WHERE v.product_id = products.id AND v.is_active = 1), price_cents),
  price_to_cents = COALESCE(
    (SELECT MAX(COALESCE(v.price_cents, products.price_cents)) FROM product_variants v
      WHERE v.product_id = products.id AND v.is_active = 1), price_cents);`;

  runFile([...updates.map((u) => u.sql), RANGE_SQL].join("\n"));
  console.log(`Converted ${updates.length} row(s) at ${rate} per unit.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
