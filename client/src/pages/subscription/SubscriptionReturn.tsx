import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";

interface SubscriptionStatusResponse {
  status: "trial" | "active" | "expired" | "canceled";
  hasAccess: boolean;
}

const MAX_POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 3000;

/**
 * Página de retorno desde Mercado Pago (success/failure/pending). El `variant` (de qué URL
 * volvió el navegador) es SOLO cosmético para el mensaje inicial — nunca se usa para decidir
 * acceso. La fuente de verdad siempre es GET /api/subscription/status, reconsultada acá con
 * polling hasta confirmar el estado real (el webhook puede llegar después del redirect).
 */
export default function SubscriptionReturn({ variant }: { variant: "success" | "failure" | "pending" }) {
  const [, navigate] = useLocation();
  const [attempts, setAttempts] = useState(0);

  const { data: status, isLoading } = useQuery<SubscriptionStatusResponse>({
    queryKey: ["/api/subscription/status"],
    refetchInterval: attempts < MAX_POLL_ATTEMPTS ? POLL_INTERVAL_MS : false,
  });

  useEffect(() => {
    if (status) setAttempts((n) => n + 1);
  }, [status]);

  useEffect(() => {
    if (status?.hasAccess) {
      const timeout = setTimeout(() => navigate("/"), 1500);
      return () => clearTimeout(timeout);
    }
  }, [status?.hasAccess, navigate]);

  const stillChecking = !status?.hasAccess && attempts < MAX_POLL_ATTEMPTS;

  return (
    <div className="flex h-screen items-center justify-center bg-background p-4" data-testid={`page-subscription-${variant}`}>
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">
          {isLoading || stillChecking ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
              <div>
                <p className="font-medium">Confirmando tu pago…</p>
                <p className="text-sm text-muted-foreground">Esto puede tardar unos segundos.</p>
              </div>
            </>
          ) : status?.hasAccess ? (
            <>
              <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400 mx-auto" />
              <div>
                <p className="font-medium">¡Suscripción confirmada!</p>
                <p className="text-sm text-muted-foreground">Redirigiéndote a la app…</p>
              </div>
            </>
          ) : variant === "failure" ? (
            <>
              <XCircle className="h-10 w-10 text-destructive mx-auto" />
              <div>
                <p className="font-medium">El pago no se pudo completar</p>
                <p className="text-sm text-muted-foreground">Podés intentarlo de nuevo cuando quieras.</p>
              </div>
              <Button onClick={() => navigate("/subscription")} data-testid="button-volver-suscripcion">
                Volver a intentar
              </Button>
            </>
          ) : (
            <>
              <Clock className="h-10 w-10 text-amber-600 dark:text-amber-400 mx-auto" />
              <div>
                <p className="font-medium">Tu pago sigue en proceso</p>
                <p className="text-sm text-muted-foreground">
                  Mercado Pago todavía no confirmó el pago. Podés revisar el estado más tarde.
                </p>
              </div>
              <Button variant="outline" onClick={() => navigate("/subscription")} data-testid="button-ver-suscripcion">
                Ver mi suscripción
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
