import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useMe } from "./hooks/useAuth";
import { Spinner, ToastProvider } from "./components/ui";
import AdminLayout from "./admin/AdminLayout";
import AdminLogin from "./admin/AdminLogin";

const Dashboard = lazy(() => import("./admin/Dashboard"));
const Products = lazy(() => import("./admin/Products"));
const ProductEditor = lazy(() => import("./admin/ProductEditor"));
const Categories = lazy(() => import("./admin/Categories"));
const Media = lazy(() => import("./admin/Media"));
const Orders = lazy(() => import("./admin/Orders"));
const OrderDetail = lazy(() => import("./admin/OrderDetail"));
const Reviews = lazy(() => import("./admin/Reviews"));
const Inbox = lazy(() => import("./admin/Inbox"));
const Subscribers = lazy(() => import("./admin/Subscribers"));
const Promos = lazy(() => import("./admin/Promos"));
const ContentAdmin = lazy(() => import("./admin/ContentAdmin"));
const SettingsAdmin = lazy(() => import("./admin/SettingsAdmin"));

function Page({ children }) {
  return (
    <Suspense fallback={<Spinner />}>
      {children}
    </Suspense>
  );
}

function Protected() {
  const { data, isLoading, error } = useMe();
  if (isLoading) {
    return (
      <div className="p-10">
        <Spinner label="Checking session" />
      </div>
    );
  }
  if (error) return <Navigate to="/admin/login" replace />;
  return <AdminLayout admin={data} />;
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<Protected />}>
          <Route index element={<Page><Dashboard /></Page>} />
          <Route path="products" element={<Page><Products /></Page>} />
          <Route path="products/new" element={<Page><ProductEditor /></Page>} />
          <Route path="products/:id" element={<Page><ProductEditor /></Page>} />
          <Route path="categories" element={<Page><Categories /></Page>} />
          <Route path="media" element={<Page><Media /></Page>} />
          <Route path="orders" element={<Page><Orders /></Page>} />
          <Route path="orders/:id" element={<Page><OrderDetail /></Page>} />
          <Route path="reviews" element={<Page><Reviews /></Page>} />
          <Route path="inbox" element={<Page><Inbox /></Page>} />
          <Route path="subscribers" element={<Page><Subscribers /></Page>} />
          <Route path="promos" element={<Page><Promos /></Page>} />
          <Route path="content" element={<Page><ContentAdmin /></Page>} />
          <Route path="settings" element={<Page><SettingsAdmin /></Page>} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </ToastProvider>
  );
}
