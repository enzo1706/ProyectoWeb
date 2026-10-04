import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import { CreditCard, CheckCircle2, Clock, AlertTriangle, Tag, X } from "lucide-react";

interface SubscriptionStatusResponse {
  status: "trial" | "active" | "expired" | "canceled";
  hasAccess: boolean;
  trialEndAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  daysRemaining: number;
  plan: { name: string; priceArs: number };
  activeCoupon: { code: string; discountType: "percentage" | "fixed"; discountValue: number; endsAt: string | null } | null;
}

interface CouponPreview {
  valid: true;
  code: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  duration: "first_payment" | "months" | "forever";
  durationMonths: number | null;
  originalPriceArs: number;
  discountedPriceArs: number;
  estimatedDiscountEndsAt: string | null;
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

function couponExplanation(coupon: CouponPreview): string {
  const discounted = `Pagás $${formatPrice(coupon.discountedPriceArs)} ARS`;
  if (coupon.duration === "first_payment") return `¡Cupón aplicado! ${discounted} tu primer mes. Después, $${formatPrice(coupon.originalPriceArs)} ARS.`;
  if (coupon.duration === "forever") return `¡Cupón aplicado! ${discounted} por mes, para siempre.`;
  return `¡Cupón aplicado! ${discounted} por mes durante ${coupon.durationMonths} ${coupon.durationMonths === 1 ? "mes" : "meses"}. Después, $${formatPrice(coupon.originalPriceArs)} ARS.`;
}

function activeCouponExplanation(coupon: NonNullable<SubscriptionStatusResponse["activeCoupon"]>): string {
  const value = coupon.discountType === "percentage" ? `${coupon.discountValue}%` : `$${formatPrice(coupon.discountValue)}`;
  return coupon.endsAt ? `Tenés un ${value} de descuento hasta el ${formatDate(coupon.endsAt)}.` : `Tenés un ${value} de descuento para siempre.`;
}

export default function Subscription() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [couponFieldOpen, setCouponFieldOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<CouponPreview | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const { data: status, isLoading, isError, error } = useQuery<SubscriptionStatusResponse>({
    queryKey: ["/api/subscription/status"],
  });

  const validateCouponMutation = useGuardedMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/coupon/validate", { code: couponCode });
      return res.json() as Promise<CouponPreview>;
    },
    onSuccess: (data) => {
      setAppliedCoupon(data);
      setCouponError(null);
    },
    onError: (err: Error) => {
      setAppliedCoupon(null);
      setCouponError(err.message);
    },
  });

  const startMutation = useGuardedMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/start", {
        email,
        ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
      });
      return res.json() as Promise<{ initPoint: string | null; activatedWithoutPayment?: boolean }>;
    },
    onSuccess: (data) => {
      if (data.activatedWithoutPayment) {
        // Cupón de 100% off: no hay a dónde redirigir, el acceso ya está activo.
        queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
        setDialogOpen(false);
        toast({ title: "¡Listo! Tu suscripción ya está activa", description: "Tu cupón cubrió el 100% del pago." });
        return;
      }
      window.location.href = data.initPoint!;
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo iniciar el pago", description: err.message, variant: "destructive" });
    },
  });

  const displayPriceArs = appliedCoupon ? appliedCoupon.discountedPriceArs : status?.plan.priceArs ?? 0;

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
                    {status.activeCoupon && (
                      <p className="text-sm text-primary mt-1" data-testid="text-active-coupon">
                        {activeCouponExplanation(status.activeCoupon)}
                      </p>
                    )}
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
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Total</span>
                {appliedCoupon ? (
                  <span className="font-medium flex items-center gap-2">
                    <span className="line-through text-muted-foreground text-xs">${formatPrice(appliedCoupon.originalPriceArs)}</span>
                    ${formatPrice(displayPriceArs)} ARS
                  </span>
                ) : (
                  <span className="font-medium">${status ? formatPrice(displayPriceArs) : ""} ARS</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Método de pago</span>
                <span className="font-medium">{displayPriceArs === 0 ? "Sin cargo (cupón 100%)" : "Mercado Pago"}</span>
              </div>
            </div>

            {!appliedCoupon && !couponFieldOpen && (
              <button
                type="button"
                onClick={() => setCouponFieldOpen(true)}
                className="text-sm text-primary hover:underline flex items-center gap-1.5"
                data-testid="link-tengo-cupon"
              >
                <Tag className="h-3.5 w-3.5" />
                ¿Tenés un cupón de descuento?
              </button>
            )}

            {!appliedCoupon && couponFieldOpen && (
              <div className="space-y-2">
                <Label htmlFor="input-coupon-code">Código de cupón</Label>
                <div className="flex gap-2">
                  <Input
                    id="input-coupon-code"
                    value={couponCode}
                    onChange={(e) => {
                      setCouponCode(e.target.value.toUpperCase());
                      setCouponError(null);
                    }}
                    placeholder="CONSULTORA123"
                    data-testid="input-coupon-code"
                  />
                  <Button
                    variant="outline"
                    onClick={() => validateCouponMutation.mutate()}
                    disabled={!couponCode || validateCouponMutation.isPending}
                    data-testid="button-aplicar-cupon"
                  >
                    Aplicar
                  </Button>
                </div>
                {couponError && (
                  <p className="text-sm text-destructive" data-testid="text-coupon-error">{couponError}</p>
                )}
              </div>
            )}

            {appliedCoupon && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm space-y-1" data-testid="card-applied-coupon">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-primary">{couponExplanation(appliedCoupon)}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setAppliedCoupon(null);
                      setCouponCode("");
                      setCouponFieldOpen(false);
                    }}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    aria-label="Quitar cupón"
                    data-testid="button-quitar-cupon"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

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
