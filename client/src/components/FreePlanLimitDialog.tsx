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
