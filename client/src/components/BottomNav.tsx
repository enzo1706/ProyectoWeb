import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, Plus, Menu as MenuIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSaleDialog } from "@/hooks/use-sale-dialog";
import { useVirtualKeyboardOpen } from "@/hooks/use-virtual-keyboard-open";
import { LipstickIcon } from "@/components/icons/LipstickIcon";
import { MasSheet } from "@/components/MasSheet";

function isRouteActive(location: string, url: string) {
  if (url === "/") return location === "/";
  return location === url || location.startsWith(`${url}/`);
}

/**
 * Prompt 13 — barra de navegación para mobile (<768px), solo para consultoras (el panel de
 * admin no la monta, ver AppShell). Se oculta por completo mientras el teclado virtual está
 * abierto (ajuste 2): siendo `fixed`, el teclado no la empuja y quedaría flotando arriba,
 * tapando lo que se está escribiendo.
 */
export function BottomNav() {
  const [location] = useLocation();
  const { openCreateSale } = useSaleDialog();
  const keyboardOpen = useVirtualKeyboardOpen();
  const [masOpen, setMasOpen] = useState(false);

  if (keyboardOpen) return null;

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
        data-testid="bottom-nav"
      >
        <div className="flex h-16 items-center justify-around px-1">
          <Link
            href="/"
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium",
              isRouteActive(location, "/") ? "text-primary" : "text-muted-foreground",
            )}
            data-testid="bottom-nav-inicio"
          >
            <LayoutDashboard className="h-5 w-5" />
            Inicio
          </Link>
          <Link
            href="/clientas"
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium",
              isRouteActive(location, "/clientas") ? "text-primary" : "text-muted-foreground",
            )}
            data-testid="bottom-nav-clientas"
          >
            <Users className="h-5 w-5" />
            Clientas
          </Link>
          <div className="flex flex-1 flex-col items-center">
            <button
              type="button"
              onClick={() => openCreateSale()}
              className="-mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover-elevate active-elevate-2"
              aria-label="Nueva venta"
              data-testid="bottom-nav-vender"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>
          <Link
            href="/productos"
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium",
              isRouteActive(location, "/productos") ? "text-primary" : "text-muted-foreground",
            )}
            data-testid="bottom-nav-stock"
          >
            <LipstickIcon className="h-5 w-5" />
            Stock
          </Link>
          <button
            type="button"
            onClick={() => setMasOpen(true)}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium text-muted-foreground"
            data-testid="bottom-nav-mas"
          >
            <MenuIcon className="h-5 w-5" />
            Más
          </button>
        </div>
      </nav>
      <MasSheet open={masOpen} onOpenChange={setMasOpen} />
    </>
  );
}
