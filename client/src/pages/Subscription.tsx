import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

interface SubscriptionStatusResponse {
  status: "trial" | "active" | "expired" | "canceled";
  hasAccess: boolean;
  trialEndAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  daysRemaining: number;
  plan: { name: string; priceArs: number };
}

const FEATURES = [
  "Gestión de productos",
  "Control de stock",
  "Gestión de clientas",
  "Agenda",
  "Ventas",
  "Reportes",
  "Gestión administrativa",
  "Gestión de imágenes",
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatPrice(priceArs: number): string {
  return priceArs.toLocaleString("es-AR");
}

export default function Subscription() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");

  const { data: status, isLoading, isError, error } = useQuery<SubscriptionStatusResponse>({
    queryKey: ["/api/subscription/status"],
  });

  const startMutation = useGuardedMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/start", { email });
      return res.json() as Promise<{ initPoint: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.initPoint;
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo iniciar el pago", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl" data-testid="page-subscription">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <CreditCard className="h-7 w-7 text-primary" />
          Suscripción
        </h1>
        <p className="text-muted-foreground">Estado de tu cuenta y plan</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" data-testid="subscription-error">
          Error al cargar el estado de la suscripción: {(error as Error).message}
        </div>
      ) : status ? (
        <>
          <Card data-testid="card-subscription-status">
            <CardContent className="pt-6">
              {status.status === "trial" && (
                <div className="flex items-start gap-3">
                  <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Estás usando la prueba gratuita</p>
                    <p className="text-sm text-muted-foreground">
                      Tu período de prueba vence el {formatDate(status.trialEndAt)} ({status.daysRemaining}{" "}
                      {status.daysRemaining === 1 ? "día" : "días"} restantes).
                    </p>
                  </div>
                </div>
              )}
              {status.status === "active" && (
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Tu suscripción está activa</p>
                    <p className="text-sm text-muted-foreground">
                      Próximo vencimiento: {formatDate(status.currentPeriodEnd)} ({status.daysRemaining}{" "}
                      {status.daysRemaining === 1 ? "día" : "días"} restantes).
                    </p>
                  </div>
                </div>
              )}
              {(status.status === "expired" || status.status === "canceled") && (
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Tu período de prueba o suscripción venció</p>
                    <p className="text-sm text-muted-foreground">Comprá la suscripción para recuperar el acceso.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-subscription-plan">
            <CardHeader>
              <CardTitle className="text-lg">{status.plan.name}</CardTitle>
              <CardDescription>Acceso a todas las funcionalidades de la aplicación.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-2xl font-bold">
                ${formatPrice(status.plan.priceArs)} ARS <span className="text-sm font-normal text-muted-foreground">/ mes</span>
              </p>
              <ul className="space-y-1.5 text-sm">
                {FEATURES.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Sin permanencia.</p>

              {status.status !== "active" && (
                <Button
                  onClick={() => setDialogOpen(true)}
                  data-testid="button-comprar-suscripcion"
                >
                  Continuar
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-confirmar-suscripcion">
          <DialogHeader>
            <DialogTitle>Confirmar suscripción</DialogTitle>
            <DialogDescription>Vas a ser redirigida a Mercado Pago para autorizar el pago.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-medium">{status?.plan.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Período</span>
                <span className="font-medium">30 días</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium">${status ? formatPrice(status.plan.priceArs) : ""} ARS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Método de pago</span>
                <span className="font-medium">Mercado Pago</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="input-subscription-email">Email para Mercado Pago</Label>
              <Input
                id="input-subscription-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                data-testid="input-subscription-email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancelar-suscripcion">
              Cancelar
            </Button>
            <Button
              onClick={() => startMutation.mutate()}
              disabled={!email || startMutation.isPending}
              data-testid="button-confirmar-pagar"
            >
              {startMutation.isPending ? "Redirigiendo..." : "Confirmar y pagar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
