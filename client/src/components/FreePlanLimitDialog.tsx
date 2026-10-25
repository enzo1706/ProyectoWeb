import { useLocation } from "wouter";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { ApiError } from "@/lib/queryClient";

/**
 * Prompt 14 (P30), ajuste — si el servidor rechaza por el límite del plan gratis desde
 * CUALQUIER camino (FreePlanProductLimitError, server/storage.ts → 403), el cartel tiene que
 * ser este mismo diálogo, nunca un toast — aunque el chequeo del lado del cliente ya haya
 * dejado pasar la acción (ej. una carga de catálogo de prueba, o una carrera entre dos
 * pestañas/dispositivos). Detecta por status + el texto exacto aprobado, nunca solo por status
 * (un 403 también puede ser, por ejemplo, "no tenés acceso").
 */
export function isFreePlanLimitError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.message.includes("límite de la prueba gratis");
}

/**
 * Prompt 14 (P30) — cartel al llegar al límite de productos del plan gratis. Texto exacto
 * aprobado (docs/prompts-mejoras.md): tiene que aparecer al tocar "+" en el producto que sería
 * el número 11 (antes de mandar nada al servidor), nunca recién cuando el servidor lo rechaza —
 * un toast no alcanza acá, por eso es un diálogo con dos acciones reales.
 */
export function FreePlanLimitDialog({
  open,
  onOpenChange,
  limit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limit: number;
}) {
  const [, setLocation] = useLocation();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-free-plan-limit">
        <AlertDialogHeader>
          <AlertDialogTitle>Llegaste al límite de la prueba gratis ({limit} productos).</AlertDialogTitle>
          <AlertDialogDescription>Suscribite para cargar todos los que quieras.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-free-plan-limit-later">Ahora no</AlertDialogCancel>
          <AlertDialogAction onClick={() => setLocation("/subscription")} data-testid="button-free-plan-limit-plans">
            Ver planes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
