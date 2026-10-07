import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Trash2 } from "lucide-react";
import { saleDraftPayloadSchema, orderDraftPayloadSchema, type Draft, type DraftType } from "@shared/schema";

/** Prompt 7, punto 7 — fecha relativa para "Ventas/Pedidos sin terminar". Una ventana chica (3
 * valores concretos) alcanza: nadie necesita precisión de hora acá, solo ubicarse rápido. */
function formatRelativeDraftDate(iso: string | Date): string {
  const updated = new Date(iso);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(updated)) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}

/** Descripción corta de un borrador para la lista — nunca falla aunque el payload tenga un
 * formato viejo/incompatible (Prompt 7, punto 2): en ese caso solo muestra lo genérico. */
function summarize(draft: Draft): { title: string; itemCount: number } {
  if (draft.type === "sale") {
    const parsed = saleDraftPayloadSchema.safeParse(draft.payload);
    if (!parsed.success) return { title: "Venta sin terminar", itemCount: 0 };
    return { title: parsed.data.clientName?.trim() || "Sin clienta", itemCount: parsed.data.lines.length };
  }
  const parsed = orderDraftPayloadSchema.safeParse(draft.payload);
  if (!parsed.success) return { title: "Pedido sin terminar", itemCount: 0 };
  return { title: "Pedido", itemCount: parsed.data.lines.length };
}

interface UnfinishedDraftsSectionProps {
  type: DraftType;
  title: string;
  onResume: (draft: Draft) => void;
}

/** Prompt 7, punto 3 del pedido original — misma estructura para "Ventas sin terminar" (en
 * Ventas) y "Pedidos sin terminar" (en Stock): Retomar abre el wizard en el paso donde quedó,
 * el tacho descarta con confirmación. */
export function UnfinishedDraftsSection({ type, title, onResume }: UnfinishedDraftsSectionProps) {
  const [discardingId, setDiscardingId] = useState<number | null>(null);

  // El queryFn por default de este proyecto junta el queryKey con "/" (ver
  // lib/queryClient.ts) — no sirve para un filtro por querystring, así que va uno propio.
  const { data: drafts = [] } = useQuery<Draft[]>({
    queryKey: ["/api/drafts", type],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/drafts?type=${type}`);
      return res.json();
    },
  });

  const deleteMutation = useGuardedMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/drafts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drafts", type] });
      setDiscardingId(null);
    },
  });

  if (drafts.length === 0) return null;

  return (
    <div className="space-y-2" data-testid={`section-unfinished-${type}`}>
      <h2 className="text-sm font-semibold text-muted-foreground">
        {title} ({drafts.length})
      </h2>
      <div className="space-y-2">
        {drafts.map((draft) => {
          const { title: rowTitle, itemCount } = summarize(draft);
          return (
            <Card key={draft.id} className="flex items-center justify-between gap-3 p-3" data-testid={`draft-row-${draft.id}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" data-testid={`text-draft-title-${draft.id}`}>
                  {rowTitle}
                </p>
                <p className="text-xs text-muted-foreground">
                  {itemCount} producto{itemCount !== 1 ? "s" : ""} · {formatRelativeDraftDate(draft.updatedAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button type="button" size="sm" onClick={() => onResume(draft)} data-testid={`button-resume-draft-${draft.id}`}>
                  Retomar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setDiscardingId(draft.id)}
                  aria-label="Descartar"
                  data-testid={`button-discard-draft-${draft.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={discardingId !== null} onOpenChange={(v) => !v && setDiscardingId(null)}>
        <AlertDialogContent data-testid="dialog-confirm-discard-draft">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {type === "sale" ? "¿Querés descartar esta venta sin terminar?" : "¿Querés descartar este pedido sin terminar?"}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-discard-draft-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (discardingId !== null) deleteMutation.mutate(discardingId);
              }}
              data-testid="button-discard-draft-confirm"
            >
              Sí, descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
