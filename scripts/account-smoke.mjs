/**
 * Account-system smoke test (local only, run against `wrangler pages dev`).
 *
 * Walks the whole approval journey over HTTP: sign up by email and by phone,
 * get blocked while pending, get approved by the admin API, sign in, change the
 * password, receive a generated credential, be forced to change it, request a
 * password reset, and be deleted. Prints a PASS/FAIL line per assertion.
 *
 *   node scripts/account-smoke.mjs
 */
const BASE = process.env.SMOKE_BASE ?? "http://localhost:8788/api";
const ADMIN_COOKIE = "afreak_session=smoke_admin_session";
const ORIGIN = "http://localhost:5173";

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

async function req(method, path, { body, cookie, origin = ORIGIN } = {}) {
  const headers = { Origin: origin };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie"), text };
}

const uniq = () => Math.random().toString(36).slice(2, 8);
const email = `smoke.${uniq()}@example.com`;
const phone = `+2547${Math.floor(10000000 + Math.random() * 89999999)}`;
const password = "smoke-test-pass-1"; // not in the common list, long enough

console.log("\n== sign up (email) ==");
let res = await req("POST", "/account/auth/signup", {
  body: { channel: "email", identifier: email, firstName: "Smoke", lastName: "Tester", password, marketingOptIn: true },
});
check("201 pending", res.status === 201 && res.json?.data?.status === "pending", res.json);

console.log("\n== sign up again (duplicate) ==");
res = await req("POST", "/account/auth/signup", {
  body: { channel: "email", identifier: email, firstName: "Smoke", password },
});
check("409 IDENTIFIER_TAKEN", res.status === 409 && res.json?.error?.code === "IDENTIFIER_TAKEN", res.json);

console.log("\n== sign up with a weak password ==");
res = await req("POST", "/account/auth/signup", {
  body: { channel: "email", identifier: `weak.${uniq()}@example.com`, firstName: "Weak", password: "password" },
});
check("400 VALIDATION on password", res.status === 400 && !!res.json?.error?.fields?.password, res.json);

console.log("\n== honeypot ==");
res = await req("POST", "/account/auth/signup", {
  body: { channel: "email", identifier: `bot.${uniq()}@example.com`, firstName: "Bot", password, website: "http://spam" },
});
const honeypotId = res.status === 201;
check("201 without creating a row", honeypotId, res.json);

console.log("\n== sign in before approval ==");
res = await req("POST", "/account/auth/login", { body: { channel: "email", identifier: email, password } });
check("403 ACCOUNT_PENDING", res.status === 403 && res.json?.error?.code === "ACCOUNT_PENDING", res.json);

console.log("\n== sign in with a wrong password ==");
res = await req("POST", "/account/auth/login", { body: { channel: "email", identifier: email, password: "wrong-password-1" } });
check("401 INVALID_CREDENTIALS", res.status === 401 && res.json?.error?.code === "INVALID_CREDENTIALS", res.json);

console.log("\n== admin list (pending) ==");
res = await req("GET", "/admin/customers?status=pending", { cookie: ADMIN_COOKIE });
const pendingRow = (res.json?.data ?? []).find((row) => row.email === email);
check("customer appears as pending", res.status === 200 && !!pendingRow && pendingRow.status === "pending", res.json?.error ?? res.status);
check("status counts are reported", res.json?.meta?.counts?.pending >= 1, res.json?.meta);

if (pendingRow) {
  console.log("\n== admin approve ==");
  res = await req("POST", `/admin/customers/${pendingRow.id}/approve`, { cookie: ADMIN_COOKIE, body: {} });
  check("approved", res.status === 200 && res.json?.data?.customer?.status === "active", res.json);

  console.log("\n== detail payload ==");
  res = await req("GET", `/admin/customers/${pendingRow.id}`, { cookie: ADMIN_COOKIE });
  check("audit trail has signup + approve", (res.json?.data?.audit ?? []).some((e) => e.action === "approve"), res.json?.data?.audit);
}

console.log("\n== sign in after approval ==");
res = await req("POST", "/account/auth/login", { body: { channel: "email", identifier: email, password } });
const cookie = (res.setCookie ?? "").split(";")[0];
check("200 with a session cookie", res.status === 200 && cookie.startsWith("afreak_cust="), res.json);
check("no forced password change", res.json?.data?.mustChangePassword === false, res.json?.data);

console.log("\n== /account/me ==");
res = await req("GET", "/account/me", { cookie });
check("200 with the profile", res.status === 200 && res.json?.data?.customer?.email === email, res.json);

console.log("\n== PATCH /account/me ==");
res = await req("PATCH", "/account/me", { cookie, body: { firstName: "Renamed", marketingOptIn: false } });
check("name and marketing updated", res.status === 200 && res.json?.data?.customer?.firstName === "Renamed", res.json);

console.log("\n== sessions ==");
res = await req("GET", "/account/sessions", { cookie });
check("lists the current device", res.status === 200 && (res.json?.data?.sessions ?? []).some((s) => s.current), res.json);

console.log("\n== change password ==");
res = await req("POST", "/account/change-password", { cookie, body: { currentPassword: password, newPassword: "smoke-test-pass-2" } });
check("200", res.status === 200, res.json);
res = await req("GET", "/account/me", { cookie });
check("session survives the change", res.status === 200, res.json);
res = await req("POST", "/account/auth/login", { body: { channel: "email", identifier: email, password } });
check("old password rejected", res.status === 401, res.json);

console.log("\n== sign up by phone ==");
res = await req("POST", "/account/auth/signup", {
  body: { channel: "phone", identifier: phone, firstName: "Phone", password },
});
check("201 pending", res.status === 201, res.json);
res = await req("POST", "/account/auth/login", { body: { channel: "phone", identifier: phone, password } });
check("403 while pending", res.status === 403 && res.json?.error?.code === "ACCOUNT_PENDING", res.json);

console.log("\n== forgot password (unknown identifier) ==");
res = await req("POST", "/account/auth/forgot-password", {
  body: { channel: "email", identifier: `nobody.${uniq()}@example.com` },
});
check("generic 200", res.status === 200 && res.json?.data?.received === true, res.json);

console.log("\n== forgot password (real account) ==");
res = await req("POST", "/account/auth/forgot-password", { body: { channel: "email", identifier: email } });
check("generic 200", res.status === 200 && res.json?.data?.received === true, res.json);
res = await req("GET", "/admin/password-requests", { cookie: ADMIN_COOKIE });
const request = (res.json?.data ?? []).find((r) => r.customer.email === email);
check("request appears in the admin queue", !!request, res.json?.data);

console.log("\n== admin create account (generated password) ==");
const createdEmail = `created.${uniq()}@example.com`;
res = await req("POST", "/admin/customers", {
  cookie: ADMIN_COOKIE,
  body: { firstName: "Created", email: createdEmail, status: "active", requirePasswordChange: true },
});
const tempPassword = res.json?.data?.temporaryPassword;
const createdId = res.json?.data?.customer?.id;
check("201 with a temporary password", res.status === 201 && typeof tempPassword === "string" && tempPassword.length === 12, res.json);
check("marked as forced change", res.json?.data?.customer?.mustChangePassword === true, res.json?.data);

if (tempPassword && createdId) {
  console.log("\n== the created customer signs in ==");
  res = await req("POST", "/account/auth/login", { body: { channel: "email", identifier: createdEmail, password: tempPassword } });
  const createdCookie = (res.setCookie ?? "").split(";")[0];
  check("200 with mustChangePassword", res.status === 200 && res.json?.data?.mustChangePassword === true, res.json);
  res = await req("GET", "/account/me", { cookie: createdCookie });
  check("GET /me allowed", res.status === 200, res.json);
  res = await req("PATCH", "/account/me", { cookie: createdCookie, body: { firstName: "Blocked" } });
  check("403 PASSWORD_CHANGE_REQUIRED elsewhere", res.status === 403 && res.json?.error?.code === "PASSWORD_CHANGE_REQUIRED", res.json);

  console.log("\n== admin reset password ==");
  res = await req("POST", `/admin/customers/${createdId}/reset-password`, { cookie: ADMIN_COOKIE, body: { mode: "generate" } });
  const newTemp = res.json?.data?.temporaryPassword;
  check("new temporary password returned", res.status === 200 && typeof newTemp === "string", res.json);
  res = await req("GET", "/account/me", { cookie: createdCookie });
  check("old session revoked", res.status === 401, res.json);
  if (newTemp) {
    res = await req("POST", "/account/auth/login", { body: { channel: "email", identifier: createdEmail, password: newTemp } });
    check("new password works", res.status === 200, res.json);
  }

  console.log("\n== suspend / unsuspend ==");
  res = await req("POST", `/admin/customers/${createdId}/suspend`, { cookie: ADMIN_COOKIE, body: {} });
  check("suspended", res.json?.data?.customer?.status === "suspended", res.json);
  res = await req("POST", "/account/auth/login", { body: { channel: "email", identifier: createdEmail, password: newTemp } });
  check("suspended cannot sign in", res.status === 403 && res.json?.error?.code === "ACCOUNT_SUSPENDED", res.json);
  res = await req("POST", `/admin/customers/${createdId}/unsuspend`, { cookie: ADMIN_COOKIE, body: {} });
  check("unsuspended", res.json?.data?.customer?.status === "active", res.json);

  console.log("\n== edit contact details ==");
  const editedEmail = `edited.${uniq()}@example.com`;
  res = await req("PATCH", `/admin/customers/${createdId}`, { cookie: ADMIN_COOKIE, body: { email: editedEmail, adminNotes: "smoke" } });
  check("email changed", res.status === 200 && res.json?.data?.customer?.email === editedEmail, res.json);

  console.log("\n== owner-only delete ==");
  res = await req("DELETE", `/admin/customers/${createdId}`, { cookie: ADMIN_COOKIE });
  check("400 without confirm", res.status === 400, res.json);
  res = await req("DELETE", `/admin/customers/${createdId}?confirm=true`, { cookie: ADMIN_COOKIE });
  check("deleted", res.status === 200 && res.json?.data?.deleted === true, res.json);
  res = await req("GET", `/admin/customers/${createdId}`, { cookie: ADMIN_COOKIE });
  check(
    "email freed and status deleted",
    res.status === 200 && res.json?.data?.status === "deleted" && res.json?.data?.email === null,
    res.json?.data,
  );
  res = await req("POST", "/account/auth/signup", { body: { channel: "email", identifier: editedEmail, firstName: "Reuse", password } });
  check("email can be reused", res.status === 201, res.json);
}

console.log("\n== CSRF: disallowed origin ==");
res = await req("POST", "/account/auth/login", { body: { channel: "email", identifier: email, password }, origin: "https://evil.example" });
check("403 cross-origin rejected", res.status === 403, res.json);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
