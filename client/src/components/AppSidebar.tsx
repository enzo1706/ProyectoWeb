import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Package,
  Users,
  ShoppingCart,
  Calendar,
  BarChart3,
  Shield,
  Settings,
  CreditCard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import type { Consultant } from "@shared/schema";

interface MenuItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

const consultantMenuItems: MenuItem[] = [
  { title: "Inicio", url: "/", icon: LayoutDashboard },
  { title: "Stock", url: "/productos", icon: Package },
  { title: "Clientes", url: "/clientas", icon: Users },
  { title: "Ventas", url: "/ventas", icon: ShoppingCart },
  { title: "Agenda", url: "/agenda", icon: Calendar },
  { title: "Reportes", url: "/reportes", icon: BarChart3 },
  { title: "Configuración", url: "/configuracion", icon: Settings },
  { title: "Suscripción", url: "/subscription", icon: CreditCard },
];

const adminMenuItems: MenuItem[] = [
  { title: "Panel", url: "/admin", icon: LayoutDashboard },
  { title: "Consultoras", url: "/admin/usuarios", icon: Users },
  { title: "Catálogo", url: "/admin/productos", icon: Package },
  { title: "Suscripciones", url: "/admin/suscripciones", icon: CreditCard },
];

function isItemActive(location: string, url: string) {
  if (url === "/") return location === "/";
  if (url === "/admin") return location === "/admin";
  return location === url || location.startsWith(`${url}/`);
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const isAdmin = user?.role === "admin";
  const menuItems = isAdmin ? adminMenuItems : consultantMenuItems;

  const { data: businessSettings } = useQuery<Consultant>({
    queryKey: ["/api/business-settings"],
    enabled: !isAdmin,
  });
  const businessName = businessSettings?.businessName || "Mi Negocio";

  const handleNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar className="print:hidden">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
            {isAdmin ? (
              <Shield className="h-4 w-4 text-primary-foreground" />
            ) : (
              <span className="text-primary-foreground font-bold text-sm">MK</span>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-sm truncate">
              {isAdmin ? "Administración" : businessName}
            </h1>
            <p className="text-xs text-muted-foreground">Manager</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {isAdmin ? "Panel de Control" : "Menú Principal"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isItemActive(location, item.url)}
                    data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Link href={item.url} onClick={handleNavigate}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <p className="text-xs text-muted-foreground text-center truncate">
          {isAdmin ? "Manager v1.0" : `${businessName} · Manager v1.0`}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
