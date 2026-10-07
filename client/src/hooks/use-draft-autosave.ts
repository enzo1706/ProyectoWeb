import { useEffect, useRef, useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { DraftType } from "@shared/schema";

// Prompt 7, regla 1: "unos segundos después de cada cambio, no en cada tecla" — el timer se
// reinicia en cada cambio de `payload`, así que solo dispara cuando pasan 3s sin un cambio
// nuevo (nunca en cada tecla individual).
const AUTOSAVE_DEBOUNCE_MS = 3000;

interface UseDraftAutosaveOptions<P> {
  type: DraftType;
  /** Prompt 7, regla 1: recién hay borrador cuando cargó algo real (clienta/producto/cantidad)
   * — nunca al abrir el diálogo vacío. También debe venir `false` en modo edición (regla 5). */
  enabled: boolean;
  payload: P;
  /** El paso actual del wizard — un cambio de paso guarda de inmediato, sin esperar el debounce. */
  step: string;
}

/**
 * Autoguardado de borradores de "Nueva venta"/"Cargar pedido" (Prompt 7) — un solo hook para
 * los dos wizards, que solo difieren en el tipo y la forma del payload. Guarda en la base por
 * `clientDraftId` (UUID generado una vez por sesión de carga, mismo patrón que
 * `sales.clientRequestId`): el servidor hace upsert sobre esa clave, nunca crea una fila
 * segunda aunque lleguen dos guardados casi simultáneos.
 */
export function useDraftAutosave<P>({ type, enabled, payload, step }: UseDraftAutosaveOptions<P>) {
  const clientDraftIdRef = useRef<string | null>(null);
  const draftIdRef = useRef<number | null>(null);
  const [draftId, setDraftId] = useState<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStepRef = useRef(step);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const save = async () => {
    if (!clientDraftIdRef.current) clientDraftIdRef.current = crypto.randomUUID();
    try {
      const res = await apiRequest("POST", "/api/drafts", {
        clientDraftId: clientDraftIdRef.current,
        type,
        payload: payloadRef.current,
      });
      const draft = await res.json();
      draftIdRef.current = draft.id;
      setDraftId(draft.id);
      queryClient.invalidateQueries({ queryKey: ["/api/drafts", type] });
    } catch {
      // Silencioso a propósito: un autoguardado que falla (red, servidor) no debe interrumpir
      // la carga — se reintenta solo con el próximo cambio o cambio de paso.
    }
  };

  const payloadKey = JSON.stringify(payload);
  useEffect(() => {
    if (!enabled) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(save, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, payloadKey]);

  useEffect(() => {
    if (!enabled) return;
    if (lastStepRef.current === step) return;
    lastStepRef.current = step;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, step]);

  /** Guardado inmediato, sin esperar el debounce — usado por "Guardar borrador" al cerrar. */
  const saveNow = async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    await save();
  };

  /** "Descartar" al cerrar, o al tirar un borrador roto (formato incompatible) desde la lista. */
  const discardDraft = async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (draftIdRef.current !== null) {
      try {
        await apiRequest("DELETE", `/api/drafts/${draftIdRef.current}`);
      } catch {
        // Best-effort: si falla, el borrador queda huérfano en la lista y se puede descartar
        // de nuevo desde ahí — nunca bloquea el cierre del diálogo.
      }
    }
    draftIdRef.current = null;
    clientDraftIdRef.current = null;
    setDraftId(null);
    queryClient.invalidateQueries({ queryKey: ["/api/drafts", type] });
  };

  /** Limpieza puramente local (sin red) — al cerrar el diálogo después de confirmar (el
   * servidor ya borró el borrador en la misma transacción) o después de "Guardar"/"Descartar"
   * (que ya hicieron su propio llamado). La próxima apertura arranca una sesión nueva. */
  const reset = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    draftIdRef.current = null;
    clientDraftIdRef.current = null;
    setDraftId(null);
  };

  /** Al retomar un borrador existente: los guardados siguientes pisan la MISMA fila, en vez
   * de crear una segunda con un clientDraftId nuevo. */
  const resumeFrom = (existing: { id: number; clientDraftId: string }) => {
    draftIdRef.current = existing.id;
    clientDraftIdRef.current = existing.clientDraftId;
    setDraftId(existing.id);
  };

  return { draftId, saveNow, discardDraft, reset, resumeFrom };
}
