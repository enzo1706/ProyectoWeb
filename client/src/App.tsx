import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Productos from "@/pages/Productos";
import Clientas from "@/pages/Clientas";
import Ventas from "@/pages/Ventas";
import Agenda from "@/pages/Agenda";
import Reportes from "@/pages/Reportes";
import Configuracion from "@/pages/Configuracion";
import AdminRouter from "@/pages/admin/AdminRouter";
import Login from "@/pages/auth/Login";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

function ConsultantRouter() {
  return (
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
              <ThemeToggle />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => logout().then(() => window.location.assign("/login"))}
                title="Cerrar sesión"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto print:overflow-visible">
            {isAdmin ? <AdminRouter /> : <ConsultantRouter />}
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
          <AppShell />
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
