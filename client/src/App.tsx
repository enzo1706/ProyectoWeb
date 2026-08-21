import { Switch, Route, Redirect, useLocation } from "wouter";
import { Suspense, lazy } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HideMoneyToggle } from "@/components/HideMoneyToggle";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { SaleCartProvider } from "@/hooks/use-sale-cart";
import { HideMoneyProvider } from "@/hooks/use-hide-money";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Login from "@/pages/auth/Login";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

// Dashboard queda de carga inmediata (es la pantalla con la que arranca toda consultora).
// El resto son rutas "secundarias" — code splitting por ruta para que nadie descargue
// Reportes (recharts) o el panel de Admin completo (read-excel-file, carga masiva de
// imágenes) si nunca entra ahí.
const Productos = lazy(() => import("@/pages/Productos"));
const Clientas = lazy(() => import("@/pages/Clientas"));
const Ventas = lazy(() => import("@/pages/Ventas"));
const Agenda = lazy(() => import("@/pages/Agenda"));
const Reportes = lazy(() => import("@/pages/Reportes"));
const Configuracion = lazy(() => import("@/pages/Configuracion"));
const AdminRouter = lazy(() => import("@/pages/admin/AdminRouter"));

function PageLoader() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function ConsultantRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/productos" component={Productos} />
        <Route path="/clientas" component={Clientas} />
        <Route path="/ventas" component={Ventas} />
        <Route path="/agenda" component={Agenda} />
        <Route path="/reportes" component={Reportes} />
        <Route path="/configuracion" component={Configuracion} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function getHomeRoute(role: string) {
  return role === "admin" ? "/admin" : "/";
}

function AppShell() {
  const [location] = useLocation();
  const { user, isLoading, logout } = useAuth();
  const isLoginRoute = location === "/login";

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isLoginRoute) {
    if (user) return <Redirect to={getHomeRoute(user.role)} />;
    return <Login />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  const isAdmin = user.role === "admin";

  if (isAdmin && !location.startsWith("/admin")) {
    return <Redirect to="/admin" />;
  }

  if (!isAdmin && location.startsWith("/admin")) {
    return <Redirect to="/" />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full bg-background print:h-auto">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden print:overflow-visible">
          <header className="flex items-center justify-between gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] border-b shrink-0 bg-background/80 backdrop-blur-sm print:hidden">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              {isAdmin && (
                <span className="text-sm font-medium text-foreground hidden md:inline">
                  Perfil de Administrador
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden md:inline">
                {user.username}
              </span>
              <HideMoneyToggle />
              <ThemeToggle />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => logout().then(() => window.location.assign("/login"))}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto print:overflow-visible">
            {isAdmin ? (
              <Suspense fallback={<PageLoader />}>
                <AdminRouter />
              </Suspense>
            ) : (
              <ConsultantRouter />
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <HideMoneyProvider>
            <SaleCartProvider>
              <AppShell />
              <Toaster />
            </SaleCartProvider>
          </HideMoneyProvider>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
