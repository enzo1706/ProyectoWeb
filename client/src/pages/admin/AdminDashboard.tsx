import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "@/components/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Package, UserCheck, Shield } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface AdminStats {
  totalConsultants: number;
  activeConsultants: number;
  activeProducts: number;
}

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
  });

  return (
    <div className="p-6 space-y-6" data-testid="page-admin-dashboard">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Panel de Administración
          </h1>
          <p className="text-muted-foreground mt-1">
            Gestión centralizada de consultoras y catálogo Mary Kay
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-primary">Admin</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          title="Total Consultoras"
          value={isLoading ? "—" : String(stats?.totalConsultants ?? 0)}
          icon={Users}
          subtitle={
            stats
              ? `${stats.activeConsultants} con acceso activo`
              : undefined
          }
        />
        <MetricCard
          title="Productos Activos"
          value={isLoading ? "—" : String(stats?.activeProducts ?? 0)}
          icon={Package}
          subtitle="En catálogo global"
        />
        <MetricCard
          title="Consultoras Activas"
          value={isLoading ? "—" : String(stats?.activeConsultants ?? 0)}
          icon={UserCheck}
          subtitle="Pueden acceder al sistema"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">
              Gestión de Consultoras
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Registra nuevas consultoras, revisa su estado y controla el acceso al sistema.
            </p>
            <Link href="/admin/usuarios">
              <Button className="w-full sm:w-auto">Ir a Consultoras</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">
              Carga de Catálogo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sube el catálogo de productos de forma masiva para todas las consultoras.
            </p>
            <Link href="/admin/productos">
              <Button variant="outline" className="w-full sm:w-auto border-primary text-primary hover:bg-primary/10">
                Ir a Catálogo
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
