import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useMe, useChangePassword } from "../hooks/useAuth";
import { centsToInput, formatDateTime, parsePriceToCents } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Field,
  PageHeader,
  Select,
  Spinner,
  TextInput,
  useToast,
} from "../components/ui";

/* ---------------------------------------------- generic settings editor */
function SettingsCard({ settingKey, title, ownerOnly, render }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const isOwner = me.data?.role === "owner";
  const query = useQuery({
    queryKey: ["setting", settingKey],
    queryFn: () => api(`/admin/settings/${settingKey}`).then((r) => r.data),
  });
  const [value, setValue] = useState(null);

  useEffect(() => {
    if (query.data !== undefined) setValue(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (v) => api(`/admin/settings/${settingKey}`, { method: "PUT", body: { value: v } }),
    onSuccess: () => {
      toast.push("Saved");
      qc.invalidateQueries({ queryKey: ["setting", settingKey] });
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const disabled = value === null || (ownerOnly && !isOwner);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="label text-graphite">{title}</p>
        <Button size="sm" variant="outline" onClick={() => save.mutate(value)} disabled={disabled}>
          Save
        </Button>
      </div>
      {ownerOnly && !isOwner && (
        <p className="mb-3 text-[12px] text-stone">Owner access required to edit.</p>
      )}
      {query.isLoading || value === null ? <Spinner label="Loading" /> : render(value, setValue)}
    </Card>
  );
}

/* --------------------------------------------------- store settings */
function StoreSettings() {
  return (
    <SettingsCard
      settingKey="store"
      title="Store details"
      ownerOnly
      render={(v, set) => (
        <div className="space-y-3">
          <Field label="Store name">
            <TextInput value={v.name ?? ""} onChange={(e) => set({ ...v, name: e.target.value })} />
          </Field>
          <Field label="Contact email">
            <TextInput value={v.email ?? ""} onChange={(e) => set({ ...v, email: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {["instagram", "tiktok", "x", "youtube"].map((k) => (
              <Field key={k} label={k}>
                <TextInput
                  value={v.social?.[k] ?? ""}
                  onChange={(e) => set({ ...v, social: { ...(v.social ?? {}), [k]: e.target.value } })}
                />
              </Field>
            ))}
          </div>
        </div>
      )}
    />
  );
}

/* --------------------------------------------------- shipping settings */
function ShippingSettings() {
  return (
    <SettingsCard
      settingKey="shipping"
      title="Shipping rates"
      ownerOnly
      render={(v, set) => (
        <div className="space-y-3">
          <Field label="Free-shipping threshold (EUR)" hint="Orders at or above this ship free">
            <TextInput
              value={centsToInput(v.threshold_cents)}
              onChange={(e) => set({ ...v, threshold_cents: parsePriceToCents(e.target.value) })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Flat rate (EUR)">
              <TextInput
                value={centsToInput(v.flat_cents)}
                onChange={(e) => set({ ...v, flat_cents: parsePriceToCents(e.target.value) })}
              />
            </Field>
            <Field label="Express rate (EUR)">
              <TextInput
                value={centsToInput(v.express_cents)}
                onChange={(e) => set({ ...v, express_cents: parsePriceToCents(e.target.value) })}
              />
            </Field>
          </div>
        </div>
      )}
    />
  );
}

/* --------------------------------------------------- payment settings */
function PaymentSettings() {
  return (
    <SettingsCard
      settingKey="demo_payment"
      title="Payment mode"
      ownerOnly
      render={(v, set) => (
        <div className="space-y-3">
          <Checkbox
            label="Demo payments enabled (no real gateway)"
            checked={!!v.enabled}
            onChange={(e) => set({ ...v, enabled: e.target.checked })}
          />
          <p className="text-[12px] text-stone">
            While enabled, orders are marked paid automatically for testing. Turn this off once a
            real payment provider is connected.
          </p>
        </div>
      )}
    />
  );
}

/* --------------------------------------------------- exchange rates */
const RATE_ORDER = ["EUR", "USD", "GBP", "KES"];

function ExchangeRatesCard() {
  const qc = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: ["exchange-rates"],
    queryFn: () => api("/admin/rates").then((r) => r.data),
  });

  const refresh = useMutation({
    mutationFn: () => api("/admin/rates/refresh", { method: "POST" }).then((r) => r.data),
    onSuccess: (data) => {
      qc.setQueryData(["exchange-rates"], data);
      toast.push("Rates refreshed");
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const data = query.data;
  const rates = data?.rates ?? {};
  const codes = RATE_ORDER;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label text-graphite">Exchange rates</p>
          <p className="mt-1 text-[12px] text-stone">
            Display-only: the storefront converts prices with these, checkout always charges EUR.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending || query.isLoading}
        >
          {refresh.isPending ? "Refreshing…" : "Refresh now"}
        </Button>
      </div>

      {query.isLoading ? (
        <Spinner />
      ) : query.isError ? (
        <p className="mt-4 text-[13px] text-danger">{query.error.message}</p>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
            {codes.map((code) => (
              <div key={code} className="border border-line px-3 py-2">
                <dt className="label text-graphite">{code}</dt>
                <dd className="mt-1 text-ink">
                  {rates[code] == null
                    ? "—"
                    : Number(rates[code]).toLocaleString("en", { maximumFractionDigits: 4 })}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-graphite">
            <span>Source: {data?.source ?? "—"}</span>
            <span aria-hidden="true">·</span>
            <span>Updated: {formatDateTime(data?.updatedAt)}</span>
            {data?.stale && <Badge tone="stone">Stale — last known rates</Badge>}
          </div>

          <p className="mt-3 text-[11px] text-stone">
            Provider quotes are per 1 USD and cached for RATES_TTL_HOURS.
          </p>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- password */
function PasswordCard() {
  const toast = useToast();
  const change = useChangePassword();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      toast.push("New passwords do not match", "danger");
      return;
    }
    try {
      await change.mutateAsync({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.push("Password changed");
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (err) {
      toast.push(err.message, "danger");
    }
  };

  return (
    <Card className="p-5">
      <p className="label mb-4 text-graphite">Change password</p>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Current password">
          <TextInput type="password" value={form.currentPassword} onChange={set("currentPassword")} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="New password" hint="10+ characters">
            <TextInput type="password" value={form.newPassword} onChange={set("newPassword")} required />
          </Field>
          <Field label="Confirm">
            <TextInput type="password" value={form.confirm} onChange={set("confirm")} required />
          </Field>
        </div>
        <Button type="submit" disabled={change.isPending}>
          Update password
        </Button>
      </form>
    </Card>
  );
}

/* ---------------------------------------------------------------- users */
function UsersCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "editor" });
  const [confirm, setConfirm] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const list = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api("/admin/users").then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const create = useMutation({
    mutationFn: (body) => api("/admin/users", { method: "POST", body }),
    onSuccess: () => {
      toast.push("User added");
      setForm({ email: "", password: "", name: "", role: "editor" });
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.push("User removed");
      invalidate();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  const rows = list.data ?? [];

  return (
    <Card className="p-5">
      <p className="label mb-4 text-graphite">Team</p>

      {list.isLoading ? (
        <Spinner />
      ) : (
        <div className="mb-5">
          {rows.map((u) => (
            <div key={u.id} className="flex items-center justify-between border-b border-line py-2.5 text-[13px] last:border-0">
              <div>
                <span className="text-graphite">{u.email}</span>
                {u.name && <span className="ml-2 text-stone">{u.name}</span>}
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={u.role === "owner" ? "solid" : "stone"}>{u.role}</Badge>
                {u.id !== me.data?.id && (
                  <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setConfirm(u)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(form);
        }}
      >
        <Field label="Email">
          <TextInput type="email" value={form.email} onChange={set("email")} required />
        </Field>
        <Field label="Name">
          <TextInput value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Temp password" hint="They can change it after signing in">
          <TextInput type="password" value={form.password} onChange={set("password")} required />
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={set("role")}>
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            Add user
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={!!confirm}
        title="Remove user"
        message={`Remove ${confirm?.email}? Their sessions will be revoked.`}
        confirmLabel="Remove"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          remove.mutate(confirm.id);
          setConfirm(null);
        }}
      />
    </Card>
  );
}

/* ----------------------------------------------------------------- page */
export default function SettingsAdmin() {
  const me = useMe();
  const isOwner = me.data?.role === "owner";

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="grid gap-4 lg:grid-cols-2">
        <StoreSettings />
        <ShippingSettings />
        <PaymentSettings />
        <ExchangeRatesCard />
        <PasswordCard />
      </div>

      {isOwner && (
        <div className="mt-4">
          <UsersCard />
        </div>
      )}
    </div>
  );
}
