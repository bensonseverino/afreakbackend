/**
 * Shared helpers for the CUSTOMERS screens.
 *
 * Kept free of JSX so both the list and the detail page can pull the same status
 * colours, date formatting and credential messages without pulling in React.
 */

/** Where customers sign in. No endpoint exposes SITE_URL to the CMS yet. */
export const SITE_URL = "https://afreak.pages.dev";

/** status -> dot colour + text label. Colours are dots only, never text. */
export const STATUS_META = {
  pending: { tone: "warn", label: "Pending" },
  active: { tone: "ok", label: "Active" },
  rejected: { tone: "danger", label: "Rejected" },
  suspended: { tone: "graphite", label: "Suspended" },
  deleted: { tone: "graphite", label: "Deleted" },
};

export const STATUS_TABS = [
  ["pending", "Pending"],
  ["active", "Active"],
  ["rejected", "Rejected"],
  ["suspended", "Suspended"],
  ["all", "All"],
];

export const SOURCE_LABEL = { self: "SELF", admin: "ADMIN", migrated: "MIGRATED" };

/** Small tone map for the source badge. */
export const SOURCE_TONE = { self: "default", admin: "outline", migrated: "stone" };

export const REJECT_REASONS = [
  "Incomplete details",
  "Duplicate account",
  "Not eligible",
  "Other",
];

/** Dial codes offered in the create/edit phone field (mirrors server dial codes). */
export const COUNTRIES = [
  { code: "KE", name: "Kenya", dial: "254" },
  { code: "UG", name: "Uganda", dial: "256" },
  { code: "TZ", name: "Tanzania", dial: "255" },
  { code: "RW", name: "Rwanda", dial: "250" },
  { code: "NG", name: "Nigeria", dial: "234" },
  { code: "GH", name: "Ghana", dial: "233" },
  { code: "ZA", name: "South Africa", dial: "27" },
  { code: "US", name: "United States", dial: "1" },
  { code: "CA", name: "Canada", dial: "1" },
  { code: "GB", name: "United Kingdom", dial: "44" },
  { code: "IE", name: "Ireland", dial: "353" },
  { code: "FR", name: "France", dial: "33" },
  { code: "DE", name: "Germany", dial: "49" },
  { code: "IT", name: "Italy", dial: "39" },
  { code: "ES", name: "Spain", dial: "34" },
  { code: "PT", name: "Portugal", dial: "351" },
  { code: "NL", name: "Netherlands", dial: "31" },
  { code: "BE", name: "Belgium", dial: "32" },
  { code: "SE", name: "Sweden", dial: "46" },
  { code: "NO", name: "Norway", dial: "47" },
  { code: "DK", name: "Denmark", dial: "45" },
  { code: "AE", name: "United Arab Emirates", dial: "971" },
  { code: "IN", name: "India", dial: "91" },
  { code: "AU", name: "Australia", dial: "61" },
];

export function displayName(customer) {
  const name = [customer?.firstName, customer?.lastName].filter(Boolean).join(" ").trim();
  return name || customer?.email || customer?.phone || "Unnamed account";
}

/** First letter of the first name plus the surname initial, for the square tile. */
export function initials(customer) {
  const first = (customer?.firstName || "").trim();
  const last = (customer?.lastName || "").trim();
  const a = first.charAt(0) || (customer?.email || "").charAt(0) || "";
  const b = last.charAt(0);
  return `${a}${b}`.toUpperCase() || "?";
}

export function primaryContact(customer) {
  return customer?.email || customer?.phone || "—";
}

/** Turn a dial code + typed number into E.164 the way the server expects it. */
export function toE164Input(dial, raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const national = digits.startsWith("0") ? digits.slice(1) : digits;
  return `+${dial}${national}`;
}

function toDate(value) {
  if (!value) return null;
  const s = String(value);
  const d = new Date(s.replace(" ", "T") + (s.includes("T") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Compact "3h ago" style label for signup / request times. */
export function relativeTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  const minutes = Math.round((Date.now() - d.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

/** The exact sign-in message an admin pastes into WhatsApp/email (spec 5.3). */
export function buildSignInMessage({ firstName, identifier, password }) {
  return [
    `Hi ${firstName || "there"}, your Afreak account is ready.`,
    `Sign in: ${SITE_URL}/account/login`,
    `Email/Phone: ${identifier}`,
    `Temporary password: ${password}`,
    "You'll be asked to choose a new password after signing in.",
  ].join("\n");
}

/** Same shape, for a password reset (spec 5.4). */
export function buildResetMessage({ firstName, identifier, password }) {
  return [
    `Hi ${firstName || "there"}, your Afreak password has been reset.`,
    `Sign in: ${SITE_URL}/account/login`,
    `Email/Phone: ${identifier}`,
    `Temporary password: ${password}`,
    "You'll be asked to choose a new password after signing in.",
  ].join("\n");
}

/** Copy to the clipboard, reporting success so the UI can confirm it. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea trick */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
