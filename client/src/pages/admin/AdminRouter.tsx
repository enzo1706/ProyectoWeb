import { Switch, Route } from "wouter";
import { AdminLayout } from "@/layouts/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import UserManagement from "@/pages/admin/UserManagement";
import ProductManagement from "@/pages/admin/ProductManagement";
import BulkImageUpload from "@/pages/admin/BulkImageUpload";
import NotFound from "@/pages/not-found";

export default function AdminRouter() {
  return (
    <AdminLayout>
      <Switch>
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/usuarios" component={UserManagement} />
        <Route path="/admin/productos" component={ProductManagement} />
        <Route path="/admin/productos/imagenes" component={BulkImageUpload} />
        <Route component={NotFound} />
      </Switch>
    </AdminLayout>
  );
}
