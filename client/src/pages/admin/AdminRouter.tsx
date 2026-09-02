import { Suspense, lazy } from "react";
import { Switch, Route } from "wouter";
import { Loader2 } from "lucide-react";
import { AdminLayout } from "@/layouts/AdminLayout";
import NotFound from "@/pages/not-found";

// Cada pantalla de admin es su propio chunk: "Catálogo" ya trae read-excel-file, y "Carga
// masiva de imágenes" su propia lógica de matching/cola — separadas, un admin que solo
// gestiona consultoras no descarga ninguna de las dos.
const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));
const UserManagement = lazy(() => import("@/pages/admin/UserManagement"));
const ProductManagement = lazy(() => import("@/pages/admin/ProductManagement"));
const BulkImageUpload = lazy(() => import("@/pages/admin/BulkImageUpload"));
const SubscriptionManagement = lazy(() => import("@/pages/admin/SubscriptionManagement"));

function AdminPageLoader() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

export default function AdminRouter() {
  return (
    <AdminLayout>
      <Suspense fallback={<AdminPageLoader />}>
        <Switch>
          <Route path="/admin" component={AdminDashboard} />
          <Route path="/admin/usuarios" component={UserManagement} />
          <Route path="/admin/productos" component={ProductManagement} />
          <Route path="/admin/productos/imagenes" component={BulkImageUpload} />
          <Route path="/admin/suscripciones" component={SubscriptionManagement} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </AdminLayout>
  );
}
