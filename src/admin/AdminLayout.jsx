import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useLogout } from "../hooks/useAuth";
import { api } from "../lib/api";
import { Button } from "../components/ui";

const NAV = [
  ["Dashboard", "/admin", true],
  ["Products", "/admin/products"],
  ["Categories", "/admin/categories"],
  ["Size charts", "/admin/size-charts"],
  ["Media", "/admin/media"],
  ["Orders", "/admin/orders"],
  ["Reviews", "/admin/reviews"],
  ["Inbox", "/admin/inbox"],
  ["Subscribers", "/admin/subscribers"],
  ["Customers", "/admin/customers"],
  ["Promos", "/admin/promos"],
  ["Content", "/admin/content"],
  ["Settings", "/admin/settings"],
];

/** Square volt badge (pending accounts + open reset requests), refreshed every 60 s. */
function CountBadge({ value }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center bg-volt px-1 text-[10px] font-bold leading-none text-ink">
      {value}
    </span>
  );
}

function NavList({ onNavigate, pendingTotal = 0 }) {
  return (
    <nav className="flex flex-col">
      {NAV.map(([label, to, end]) => (
        <NavLink
          key={to}
          to={to}
          end={!!end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `label relative flex items-center justify-between gap-2 border-l-[3px] px-5 py-3.5 transition-colors ${
              isActive
                ? "border-volt bg-white/10 text-paper"
                : "border-transparent text-white/60 hover:text-paper"
            }`
          }
        >
          <span>{label}</span>
          {to === "/admin/customers" && pendingTotal > 0 && <CountBadge value={pendingTotal} />}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AdminLayout({ admin }) {
  const [open, setOpen] = useState(false);
  const logout = useLogout();
  const navigate = useNavigate();

  const counts = useQuery({
    queryKey: ["admin-customer-counts"],
    queryFn: () => api("/admin/customers/counts").then((r) => r.data),
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });
  const pendingTotal = (counts.data?.pending ?? 0) + (counts.data?.openResetRequests ?? 0);

  const onLogout = async () => {
    await logout.mutateAsync();
    navigate("/admin/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-mist lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-[240px] shrink-0 bg-ink lg:flex lg:flex-col">
        <div className="border-b border-white/10 px-5 py-6">
          <p className="font-display text-[20px] font-extrabold tracking-tight text-paper">AFREAK</p>
          <p className="label mt-1 inline-block border border-white/30 px-1.5 py-0.5 text-white/70">
            Admin
          </p>
        </div>
        <NavList pendingTotal={pendingTotal} />
        <div className="mt-auto border-t border-white/10 p-4">
          <p className="label mb-3 text-white/50">{admin?.email}</p>
          <div className="flex flex-col gap-2">
            <a
              href="/"
              className="label border border-white/20 px-3 py-2 text-center text-white/70 hover:text-paper"
            >
              View site
            </a>
            <Button variant="ghost" size="md" className="!border-white/20 !text-white/70" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-line bg-ink px-4 py-3 lg:hidden">
        <button className="label text-paper" onClick={() => setOpen(true)}>
          ☰ Menu
        </button>
        <span className="font-display text-[16px] font-extrabold text-paper">AFREAK</span>
        <span className="label text-white/60">{admin?.role}</span>
      </div>

      {/* Mobile slide-over */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[260px] overflow-y-auto bg-ink">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
              <span className="font-display font-extrabold text-paper">AFREAK</span>
              <button className="label text-white/60" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <NavList onNavigate={() => setOpen(false)} pendingTotal={pendingTotal} />
            <div className="p-4">
              <Button variant="ghost" className="!border-white/20 !text-white/70" onClick={onLogout}>
                Sign out
              </Button>
            </div>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1280px] p-4 pb-24 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
