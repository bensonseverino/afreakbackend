import { useState } from "react";
import { useNavigate } from "react-router";
import { useLogin, useMe, useSetup } from "../hooks/useAuth";
import { Button, Field, TextInput, useToast } from "../components/ui";

export default function AdminLogin() {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();

  const needsSetup = me.data?.needsSetup === true;
  const [form, setForm] = useState({ email: "", password: "", name: "", token: "" });
  const login = useLogin();
  const setup = useSetup();

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (needsSetup) {
        await setup.mutateAsync({
          token: form.token,
          email: form.email,
          password: form.password,
          name: form.name,
        });
        toast.push("Owner account created");
      } else {
        await login.mutateAsync({ email: form.email, password: form.password });
      }
      navigate("/admin", { replace: true });
    } catch (err) {
      toast.push(err.message, "danger");
    }
  };

  const pending = login.isPending || setup.isPending;

  return (
    <div className="flex min-h-screen items-center justify-center bg-mist p-4">
      <form onSubmit={submit} className="w-full max-w-sm border border-line bg-card p-6">
        <p className="font-display text-[22px] font-extrabold tracking-tight">AFREAK</p>
        <p className="label mt-1 mb-6 text-stone">
          {needsSetup ? "First-run setup" : "Admin sign in"}
        </p>

        {needsSetup && (
          <Field label="Setup token" hint="The value of your SETUP_TOKEN secret" className="mb-4">
            <TextInput value={form.token} onChange={set("token")} required />
          </Field>
        )}

        <Field label="Email" className="mb-4">
          <TextInput type="email" value={form.email} onChange={set("email")} required />
        </Field>

        {needsSetup && (
          <Field label="Name" className="mb-4">
            <TextInput value={form.name} onChange={set("name")} />
          </Field>
        )}

        <Field
          label="Password"
          hint={needsSetup ? "At least 10 characters" : undefined}
          className="mb-6"
        >
          <TextInput type="password" value={form.password} onChange={set("password")} required />
        </Field>

        <Button type="submit" disabled={pending} className="w-full" size="lg">
          {pending ? "Please wait…" : needsSetup ? "Create account" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
