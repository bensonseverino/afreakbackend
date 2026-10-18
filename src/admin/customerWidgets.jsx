import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Modal,
  Select,
  StatusDot,
  TextArea,
  TextInput,
  useToast,
} from "../components/ui";
import {
  REJECT_REASONS,
  SOURCE_LABEL,
  SOURCE_TONE,
  STATUS_META,
  buildResetMessage,
  buildSignInMessage,
  copyText,
  displayName,
  primaryContact,
  relativeTime,
} from "./customerUtils";

/* --------------------------------------------------------------- labels */

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? { tone: "graphite", label: status ?? "unknown" };
  return (
    <span className="label inline-flex items-center gap-2 border border-line bg-card px-2 py-1">
      <StatusDot tone={meta.tone} />
      {meta.label}
    </span>
  );
}

export function SourceBadge({ source }) {
  const label = SOURCE_LABEL[source] ?? String(source ?? "").toUpperCase();
  return <Badge tone={SOURCE_TONE[source] ?? "default"}>{label}</Badge>;
}

/** Segmented control (EMAIL | PHONE | BOTH, GENERATE | SET MANUALLY). */
export function Segmented({ options, value, onChange }) {
  return (
    <div className="flex border border-line">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`label min-h-12 flex-1 px-3 py-3 ${
            value === key ? "bg-ink text-paper" : "bg-card text-stone hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- credentials card */

/**
 * The one time we ever show a password. It lives only in this component's props
 * (never written to the cache) and is gone the moment the card unmounts.
 */
export function CredentialsCard({ firstName, identifier, password, kind = "created", onDone }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const message =
    kind === "reset"
      ? buildResetMessage({ firstName, identifier, password })
      : buildSignInMessage({ firstName, identifier, password });

  const copy = async (text, label) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      toast.push(`${label} copied`);
    } else {
      toast.push("Could not copy — select the text manually", "danger");
    }
  };

  const finish = () => {
    if (copied || confirming) onDone();
    else setConfirming(true);
  };

  return (
    <div className="border border-line bg-card">
      <div className="border-b border-line px-5 py-4">
        <p className="label text-stone">{kind === "reset" ? "New password" : "Account created"}</p>
      </div>

      <div className="space-y-4 p-5">
        <Field label="Sign-in identifier">
          <div className="flex gap-2">
            <TextInput readOnly value={identifier} className="h-[52px]" />
            <Button
              type="button"
              variant="outline"
              className="h-[52px] shrink-0"
              onClick={() => copy(identifier, "Identifier")}
            >
              COPY
            </Button>
          </div>
        </Field>

        <Field label="Temporary password">
          <div className="flex gap-2">
            <span className="flex h-[52px] flex-1 items-center overflow-x-auto border border-line bg-mist px-3 font-mono text-[15px]">
              {password}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-[52px] shrink-0"
              onClick={() => copy(password, "Password")}
            >
              COPY
            </Button>
          </div>
        </Field>

        <p className="border border-warn px-3 py-2 text-[12px] text-warn">
          Shown once. It can&apos;t be retrieved later — reset the password if lost.
        </p>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => copy(message, "Sign-in message")}
        >
          COPY SIGN-IN MESSAGE
        </Button>

        {confirming && (
          <div className="border border-danger p-3">
            <p className="text-[13px] text-danger">
              You haven&apos;t copied the password. Close anyway?
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                Keep it open
              </Button>
              <Button type="button" variant="danger" onClick={onDone}>
                Close without copying
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line px-5 py-4">
        <Button type="button" className="h-12 w-full" onClick={finish}>
          DONE
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- reset password */

export function ResetPasswordDialog({ customer, onClose, onSuccess }) {
  const toast = useToast();
  const [mode, setMode] = useState("generate");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [requireChange, setRequireChange] = useState(true);
  const [fieldError, setFieldError] = useState(null);
  const [result, setResult] = useState(null);

  const reset = useMutation({
    mutationFn: () =>
      api(`/admin/customers/${encodeURIComponent(customer.id)}/reset-password`, {
        method: "POST",
        body: {
          mode,
          ...(mode === "set" ? { password } : {}),
          requirePasswordChange: requireChange,
        },
      }),
    onSuccess: (r) => {
      setResult(r.data);
      onSuccess?.();
    },
    onError: (e) => {
      if (e.fields?.password) setFieldError(e.fields.password);
      else toast.push(e.message, "danger");
    },
  });

  const submit = (e) => {
    e.preventDefault();
    setFieldError(null);
    reset.mutate();
  };

  if (result) {
    const c = result.customer ?? customer;
    return (
      <Modal open onClose={onClose} title="Password reset">
        <CredentialsCard
          firstName={c.firstName}
          identifier={c.email || c.phone || "—"}
          password={result.temporaryPassword}
          kind="reset"
          onDone={onClose}
        />
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Reset password">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13px] text-graphite">
          Set a new password for <strong>{displayName(customer)}</strong> (
          {primaryContact(customer)}).
        </p>

        <Segmented
          options={[
            ["generate", "GENERATE"],
            ["set", "SET MANUALLY"],
          ]}
          value={mode}
          onChange={setMode}
        />

        {mode === "set" && (
          <Field
            label="New password"
            error={fieldError}
            hint="At least 8 characters. Not the email or phone number."
          >
            <div className="flex gap-2">
              <TextInput
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-[52px]"
                autoComplete="new-password"
              />
              <Button
                type="button"
                variant="ghost"
                className="h-[52px] shrink-0"
                onClick={() => setShow((s) => !s)}
              >
                {show ? "HIDE" : "SHOW"}
              </Button>
            </div>
          </Field>
        )}

        <Checkbox
          label="Require change at next sign-in"
          checked={requireChange}
          onChange={(e) => setRequireChange(e.target.checked)}
        />

        <p className="border border-line bg-mist px-3 py-2 text-[12px] text-graphite">
          This signs the customer out of all devices.
        </p>

        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" className="min-h-12" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="min-h-12"
            disabled={reset.isPending || (mode === "set" && password.length === 0)}
          >
            {reset.isPending ? "Resetting…" : "RESET PASSWORD"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- approve */

export function ApproveDialog({ customer, onClose, onSuccess }) {
  const toast = useToast();
  const [link, setLink] = useState(false);
  const [note, setNote] = useState("");
  const matches = Number(customer?.guestOrderMatches ?? 0);

  const approve = useMutation({
    mutationFn: () =>
      api(`/admin/customers/${encodeURIComponent(customer.id)}/approve`, {
        method: "POST",
        body: {
          linkGuestOrders: matches > 0 ? link : false,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast.push("Account approved");
      onSuccess?.();
      onClose();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Approve account"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="h-12"
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
          >
            {approve.isPending ? "Approving…" : "APPROVE ACCOUNT"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="font-display text-[16px] font-extrabold uppercase">
            {displayName(customer)}
          </p>
          <p className="mt-1 text-[13px] text-graphite">{primaryContact(customer)}</p>
          <p className="mt-1 text-[12px] text-stone">
            Signed up {relativeTime(customer?.createdAt)}
          </p>
        </div>

        {matches > 0 && (
          <div className="border border-line p-3">
            <Checkbox
              label={`LINK ${matches} PAST GUEST ORDER${matches === 1 ? "" : "S"}`}
              checked={link}
              onChange={(e) => setLink(e.target.checked)}
            />
            <p className="mt-2 text-[12px] text-stone">
              {matches} unlinked order{matches === 1 ? "" : "s"} carry this email or phone. Off by
              default so you can review the match first.
            </p>
          </div>
        )}

        <Field label="Note (optional)">
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- reject */

export function RejectDialog({ customer, onClose, onSuccess }) {
  const toast = useToast();
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [note, setNote] = useState("");

  const reject = useMutation({
    mutationFn: () =>
      api(`/admin/customers/${encodeURIComponent(customer.id)}/reject`, {
        method: "POST",
        body: { reason: [reason, note.trim()].filter(Boolean).join(" — ") },
      }),
    onSuccess: () => {
      toast.push("Request rejected");
      onSuccess?.();
      onClose();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Reject request"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="h-12"
            onClick={() => reject.mutate()}
            disabled={reject.isPending}
          >
            {reject.isPending ? "Rejecting…" : "REJECT REQUEST"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-graphite">
          Reject <strong>{displayName(customer)}</strong> ({primaryContact(customer)})? The reason
          stays internal.
        </p>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)} className="h-[52px]">
            {REJECT_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)">
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ edit */

export function EditCustomerDialog({ customer, onClose, onSuccess }) {
  const toast = useToast();
  const [form, setForm] = useState({
    firstName: customer?.firstName ?? "",
    lastName: customer?.lastName ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
  });
  const [fields, setFields] = useState({});

  const save = useMutation({
    mutationFn: () =>
      api(`/admin/customers/${encodeURIComponent(customer.id)}`, {
        method: "PATCH",
        body: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
        },
      }),
    onSuccess: () => {
      toast.push("Customer updated");
      onSuccess?.();
      onClose();
    },
    onError: (e) => {
      if (e.fields) setFields(e.fields);
      else toast.push(e.message, "danger");
    },
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit customer"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="h-12"
            onClick={() => {
              setFields({});
              save.mutate();
            }}
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "SAVE CHANGES"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="border border-line bg-mist px-3 py-2 text-[12px] text-graphite">
          Changing the email or phone changes the customer&apos;s sign-in identifier.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="First name" error={fields.firstName}>
            <TextInput value={form.firstName} onChange={set("firstName")} className="h-[52px]" />
          </Field>
          <Field label="Last name">
            <TextInput value={form.lastName} onChange={set("lastName")} className="h-[52px]" />
          </Field>
        </div>
        <Field label="Email" error={fields.email}>
          <TextInput type="email" value={form.email} onChange={set("email")} className="h-[52px]" />
        </Field>
        <Field label="Phone" error={fields.phone} hint="E.164, e.g. +254712345678.">
          <TextInput type="tel" value={form.phone} onChange={set("phone")} className="h-[52px]" />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- delete */

export function DeleteCustomerDialog({ customer, onClose, onSuccess }) {
  const toast = useToast();
  const [confirmText, setConfirmText] = useState("");

  const remove = useMutation({
    mutationFn: () =>
      api(`/admin/customers/${encodeURIComponent(customer.id)}?confirm=true`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.push("Customer deleted");
      onSuccess?.();
      onClose();
    },
    onError: (e) => toast.push(e.message, "danger"),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete account"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="h-12"
            onClick={() => remove.mutate()}
            disabled={remove.isPending || confirmText !== "DELETE"}
          >
            {remove.isPending ? "Deleting…" : "DELETE ACCOUNT"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-graphite">
          Delete <strong>{displayName(customer)}</strong> ({primaryContact(customer)})?
        </p>
        <div className="border border-line bg-mist p-3 text-[13px] text-graphite">
          <p className="label mb-2 text-stone">Removed</p>
          <p>Profile, contact details, admin notes, addresses, saved payment tokens, wishlist and all sessions.</p>
          <p className="label mt-3 mb-2 text-stone">Kept</p>
          <p>Orders stay for accounting — they are kept but unlinked. The email and phone become reusable.</p>
        </div>
        <Field label="Type DELETE to confirm">
          <TextInput
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            className="h-[52px]"
          />
        </Field>
      </div>
    </Modal>
  );
}
