/**
 * Outbound customer notifications.
 *
 * Deliberately stubs: approval by an admin replaces email/SMS verification, and
 * the CMS has a "Copy message" helper the team uses to share credentials
 * (WhatsApp/SMS) by hand. When a provider is added these become real sends — the
 * call sites already live in the right places.
 *
 * Never include a password in a notification.
 */
import type { Customer } from "./customers";

export function notifyApproved(customer: Customer): void {
  // TODO: email (Resend) / SMS provider
  console.info(`[notify] account approved for ${customer.id}`);
}

export function notifyRejected(customer: Customer, reason?: string | null): void {
  // TODO: email (Resend) / SMS provider — the reason stays internal, so it is
  // not part of the notification.
  console.info(`[notify] account rejected for ${customer.id} (${reason ? "with reason" : "no reason"})`);
}

export function notifyPasswordReset(customer: Customer): void {
  // TODO: email (Resend) / SMS provider
  console.info(`[notify] password reset for ${customer.id}`);
}
