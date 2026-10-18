import { useState } from "react";
import { useNavigate } from "react-router";
import { useLogin } from "../hooks/useAuth";
import { Button, Field, TextInput, useToast } from "../components/ui";

/**
 * Built-in owner account, provisioned by migrations/0006_default_admin.sql.
 * Change the password from Settings after signing in.
 */
const DEFAULT_LOGIN = { email: "owner@afreak.com", password: "afreak-dev-admin-1" };

export default function AdminLogin() {
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState(DEFAULT_LOGIN);
  const login = useLogin();

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    try {
      await login.mutateAsync({ email: form.email, password: form.password });
      navigate("/admin", { replace: true });
    } catch (err) {
      toast.push(err.message, "danger");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-mist p-4">
      <form onSubmit={submit} className="w-full max-w-sm border border-line bg-card p-6">
        <p className="font-display text-[22px] font-extrabold tracking-tight">AFREAK</p>
        <p className="label mt-1 mb-6 text-stone">Admin sign in</p>

        <Field label="Email" className="mb-4">
          <TextInput type="email" value={form.email} onChange={set("email")} required />
        </Field>

        <Field label="Password" className="mb-6">
          <TextInput type="password" value={form.password} onChange={set("password")} required />
        </Field>

        <Button type="submit" disabled={login.isPending} className="w-full" size="lg">
          {login.isPending ? "Please wait…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
