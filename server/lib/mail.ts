/**
 * Email is stubbed for now. Replace the bodies with a real provider
 * (Resend / Postmark) and keep the calls non-blocking — never fail an
 * order because an email could not be sent.
 */
import type { Env } from "../env";

export type OrderEmail = {
  number: string;
  email: string;
  totalCents: number;
  currency: string;
};

export async function sendOrderEmail(env: Env, order: OrderEmail): Promise<void> {
  // TODO: Resend/Postmark. Do not throw on failure.
  console.log(`[mail] order confirmation stub → ${order.email} (${order.number})`);
}

export async function sendShippingEmail(
  env: Env,
  order: { number: string; email: string; trackingNumber?: string | null },
): Promise<void> {
  // TODO: Resend/Postmark.
  console.log(`[mail] shipped stub → ${order.email} (${order.number})`);
}
