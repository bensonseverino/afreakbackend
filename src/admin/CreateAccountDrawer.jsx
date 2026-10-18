import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Button, Checkbox, Field, Select, TextInput, useToast } from "../components/ui";
import { CredentialsCard, Segmented } from "./customerWidgets";
import { COUNTRIES, toE164Input } from "./customerUtils";

const EMPTY = {
  firstName: "",
  lastName: "",
  channel: "email",
  country: "KE",
  email: "",
  phone: "",
  mode: "generate",
  password: "",
  showPassword: false,
  requirePasswordChange: true,
  activateImmediately: true,
  linkGuestOrders: false,
  marketingOptIn: false,
};

/**
 * Create-account drawer: a right-side panel on desktop, a full-screen sheet on
 * mobile. On success it swaps the form for the credentials card, which is the
 * only place the generated password ever exists on the client.
 */
export default function CreateAccountDrawer({ onClose, onSuccess }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [fields, setFields] = useState({});
  const [result, setResult] = useState(null);

  const set = (key) => (e) =>
    setForm((f) => ({
      ...f,
      [key]: e.target?.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  const wantsEmail = form.channel === "email" || form.channel === "both";
  const wantsPhone = form.channel === "phone" || form.channel === "both";
  const dial = COUNTRIES.find((c) => c.code === form.country)?.dial ?? "254";

  const create = useMutation({
    mutationFn: () =>
      api("/admin/customers", {
        method: "POST",
        body: {
          firstName: form.firstName.trim(),
          ...(form.lastName.trim() ? { lastName: form.lastName.trim() } : {}),
          ...(wantsEmail && form.email.trim() ? { email: form.email.trim() } : {}),
          ...(wantsPhone && form.phone.trim()
            ? { phone: toE164Input(dial, form.phone) }
            : {}),
          status: form.activateImmediately ? "active" : "pending",
          ...(form.mode === "set" ? { password: form.password } : {}),
          requirePasswordChange: form.requirePasswordChange,
          linkGuestOrders: form.linkGuestOrders,
          marketingOptIn: form.marketingOptIn,
        },
      }),
    onSuccess: (r) => setResult(r.data),
    onError: (e) => {
      if (e.fields) setFields(e.fields);
      else toast.push(e.message, "danger");
    },
  });

  const canSubmit =
    form.firstName.trim().length > 0 &&
    (!wantsEmail || form.email.trim().length > 0) &&
    (!wantsPhone || form.phone.trim().length > 0) &&
    (form.mode === "generate" || form.password.length > 0);

  const submit = (e) => {
    e.preventDefault();
    setFields({});
    create.mutate();
  };

  const identifier = result
    ? result.customer.email || result.customer.phone || "—"
    : "";

  return (
    <div className="fixed inset-0 z-50">
      {!result && <div className="absolute inset-0 bg-ink/50" onClick={onClose} />}

      <div className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-line bg-card lg:w-[480px]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-[15px] font-extrabold uppercase">Create account</h2>
          {!result && (
            <button onClick={onClose} className="label text-stone hover:text-ink">
              Close
            </button>
          )}
        </div>

        {result ? (
          <div className="flex-1 overflow-y-auto p-5">
            <CredentialsCard
              firstName={result.customer.firstName}
              identifier={identifier}
              password={result.temporaryPassword}
              kind="created"
              onDone={() => {
                onSuccess?.();
                onClose();
              }}
            />
            {result.linkedOrders > 0 && (
              <p className="mt-3 text-[12px] text-stone">
                Linked {result.linkedOrders} past guest order
                {result.linkedOrders === 1 ? "" : "s"}.
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="First name" error={fields.firstName}>
                  <TextInput
                    value={form.firstName}
                    onChange={set("firstName")}
                    className="h-[52px]"
                    required
                  />
                </Field>
                <Field label="Last name (optional)">
                  <TextInput value={form.lastName} onChange={set("lastName")} className="h-[52px]" />
                </Field>
              </div>

              <div>
                <p className="label mb-2 text-graphite">Contact</p>
                <Segmented
                  options={[
                    ["email", "EMAIL"],
                    ["phone", "PHONE"],
                    ["both", "BOTH"],
                  ]}
                  value={form.channel}
                  onChange={(channel) => setForm((f) => ({ ...f, channel }))}
                />
              </div>

              {wantsEmail && (
                <Field label="Email" error={fields.email}>
                  <TextInput
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    className="h-[52px]"
                    autoComplete="off"
                  />
                </Field>
              )}

              {wantsPhone && (
                <Field label="Phone" error={fields.phone} hint="National or international number.">
                  <div className="flex gap-2">
                    <Select
                      value={form.country}
                      onChange={set("country")}
                      className="h-[52px] w-[110px] shrink-0"
                      aria-label="Country code"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name} +{c.dial}
                        </option>
                      ))}
                    </Select>
                    <TextInput
                      type="tel"
                      value={form.phone}
                      onChange={set("phone")}
                      className="h-[52px]"
                      placeholder="712 345 678"
                      autoComplete="off"
                    />
                  </div>
                </Field>
              )}

              <div>
                <p className="label mb-2 text-graphite">Password</p>
                <Segmented
                  options={[
                    ["generate", "GENERATE SECURE PASSWORD"],
                    ["set", "SET MANUALLY"],
                  ]}
                  value={form.mode}
                  onChange={(mode) => setForm((f) => ({ ...f, mode }))}
                />
              </div>

              {form.mode === "set" && (
                <Field
                  label="Password"
                  error={fields.password}
                  hint="At least 8 characters. Not the email or phone number."
                >
                  <div className="flex gap-2">
                    <TextInput
                      type={form.showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={set("password")}
                      className="h-[52px]"
                      autoComplete="new-password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-[52px] shrink-0"
                      onClick={() => setForm((f) => ({ ...f, showPassword: !f.showPassword }))}
                    >
                      {form.showPassword ? "HIDE" : "SHOW"}
                    </Button>
                  </div>
                </Field>
              )}

              <div className="space-y-3 border border-line p-3">
                <Checkbox
                  label="Require password change at first sign-in"
                  checked={form.requirePasswordChange}
                  onChange={set("requirePasswordChange")}
                />
                <Checkbox
                  label="Activate immediately"
                  checked={form.activateImmediately}
                  onChange={set("activateImmediately")}
                />
                <Checkbox
                  label="Link past guest orders"
                  checked={form.linkGuestOrders}
                  onChange={set("linkGuestOrders")}
                />
                <p className="text-[12px] text-stone">
                  Links unlinked orders that carry this email or phone, if any exist.
                </p>
                <Checkbox
                  label="Subscribe to marketing"
                  checked={form.marketingOptIn}
                  onChange={set("marketingOptIn")}
                />
              </div>
            </div>

            <div className="border-t border-line p-5">
              <Button
                type="submit"
                className="h-12 w-full"
                disabled={create.isPending || !canSubmit}
              >
                {create.isPending ? "Creating…" : "CREATE ACCOUNT"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
