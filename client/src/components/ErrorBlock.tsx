import { AlertTriangle } from "lucide-react";

/** Estado de error inline reutilizable — nunca mostrar el JSON/stack crudo del error, solo
 * su mensaje ya legible (los errores de apiRequest ya vienen como texto plano). */
export function ErrorBlock({ error, message }: { error?: Error; message?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
      data-testid="error-block"
    >
      <AlertTriangle className="h-6 w-6 text-destructive" />
      <p className="text-sm text-destructive">{message ?? `No se pudo cargar: ${error?.message}`}</p>
    </div>
  );
}
