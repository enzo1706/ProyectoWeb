import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Package,
  Users,
  ShoppingCart,
  Calendar,
  BarChart3,
  Settings,
  CreditCard,
  Tag,
  LogOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LipstickIcon } from "@/components/icons/LipstickIcon";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { BrandLogo } from "@/components/BrandLogo";
import { LogoutConfirmDialog } from "@/components/LogoutConfirmDialog";
import type { Consultant } from "@shared/schema";

interface MenuItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

const consultantMenuItems: MenuItem[] = [
  { title: "Inicio", url: "/", icon: LayoutDashboard },
  { title: "Stock", url: "/productos", icon: LipstickIcon },
  { title: "Clientas", url: "/clientas", icon: Users },
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
  { title: "Precio y cupones", url: "/admin/suscripcion-precio", icon: Tag },
];

function isItemActive(location: string, url: string) {
  if (url === "/") return location === "/";
  if (url === "/admin") return location === "/admin";
  return location === url || location.startsWith(`${url}/`);
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const isAdmin = user?.role === "admin";
  const menuItems = isAdmin ? adminMenuItems : consultantMenuItems;
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const handleLogout = () => {
    setLogoutConfirmOpen(false);
    logout().then(() => window.location.assign("/login"));
  };

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
          <BrandLogo size={32} />
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
      <SidebarFooter className="p-4 gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => setLogoutConfirmOpen(true)}
          data-testid="button-sidebar-logout"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </Button>
        <p className="text-xs text-muted-foreground text-center truncate">
          {isAdmin ? "Manager v1.0" : `${businessName} · Manager v1.0`}
        </p>
      </SidebarFooter>
      <LogoutConfirmDialog
        open={logoutConfirmOpen}
        onOpenChange={setLogoutConfirmOpen}
        onConfirm={handleLogout}
      />
    </Sidebar>
  );
}
