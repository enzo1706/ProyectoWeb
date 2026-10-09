import { useState } from "react";
import { useLocation } from "wouter";
import { ShoppingCart, Calendar, BarChart3, Settings, CreditCard, LogOut, type LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { LogoutConfirmDialog } from "@/components/LogoutConfirmDialog";

interface MasSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MasMenuItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

// Prompt 13, decisión anotada en docs/prompts-mejoras.md: el orden es Ventas, Agenda,
// Reportes, Configuración, Suscripción, y "Cerrar sesión" separado al final.
const masMenuItems: MasMenuItem[] = [
  { title: "Ventas", url: "/ventas", icon: ShoppingCart },
  { title: "Agenda", url: "/agenda", icon: Calendar },
  { title: "Reportes", url: "/reportes", icon: BarChart3 },
  { title: "Configuración", url: "/configuracion", icon: Settings },
  { title: "Suscripción", url: "/subscription", icon: CreditCard },
];

/** Prompt 13 — reemplaza al sidebar en mobile: botones grandes de icono+texto, igual lista de secciones que ya tenía el menú lateral menos las que ya están en la barra inferior (Inicio, Clientas, Stock). */
export function MasSheet({ open, onOpenChange }: MasSheetProps) {
  const [, setLocation] = useLocation();
  const { logout } = useAuth();
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const navigateTo = (url: string) => {
    onOpenChange(false);
    setLocation(url);
  };

  const handleLogout = () => {
    setLogoutConfirmOpen(false);
    onOpenChange(false);
    logout().then(() => window.location.assign("/login"));
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="sheet-mas">
          <SheetHeader>
            <SheetTitle>Más</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-3 py-4">
            {masMenuItems.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => navigateTo(item.url)}
                className="flex flex-col items-center gap-2 rounded-xl border bg-muted/40 p-4 hover-elevate active-elevate-2"
                data-testid={`mas-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <item.icon className="h-6 w-6 text-primary" />
                <span className="text-sm font-medium text-center">{item.title}</span>
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={() => setLogoutConfirmOpen(true)}
            data-testid="mas-button-logout"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </Button>
        </SheetContent>
      </Sheet>
      <LogoutConfirmDialog
        open={logoutConfirmOpen}
        onOpenChange={setLogoutConfirmOpen}
        onConfirm={handleLogout}
      />
    </>
  );
}
