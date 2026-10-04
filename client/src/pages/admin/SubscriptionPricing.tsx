import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tag, DollarSign, Plus } from "lucide-react";

type PriceChangeScope = "new_only" | "all";
type CouponDiscountType = "percentage" | "fixed";
type CouponDuration = "first_payment" | "months" | "forever";

interface PriceHistoryEntry {
  id: number;
  oldPriceArs: number | null;
  newPriceArs: number;
  appliesTo: PriceChangeScope;
  effectiveAt: string | null;
  appliedAt: string | null;
  changedAt: string;
  changedByAdminId: number | null;
}

interface PriceResponse {
  currentPriceArs: number;
  history: PriceHistoryEntry[];
}

interface CouponRow {
  id: number;
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  duration: CouponDuration;
  durationMonths: number | null;
  maxUses: number | null;
  activeUses: number;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
}

function formatPrice(n: number): string {
  return `$${n.toLocaleString("es-AR")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function couponStatus(coupon: CouponRow): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (!coupon.active) return { label: "Desactivado", variant: "outline" };
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) return { label: "Vencido", variant: "destructive" };
  if (coupon.maxUses !== null && coupon.activeUses >= coupon.maxUses) return { label: "Agotado", variant: "secondary" };
  return { label: "Activo", variant: "default" };
}

function discountLabel(coupon: Pick<CouponRow, "discountType" | "discountValue">): string {
  return coupon.discountType === "percentage" ? `${coupon.discountValue}%` : formatPrice(coupon.discountValue);
}

function durationLabel(coupon: Pick<CouponRow, "duration" | "durationMonths">): string {
  if (coupon.duration === "first_payment") return "Solo el primer pago";
  if (coupon.duration === "forever") return "Para siempre";
  return `${coupon.durationMonths} ${coupon.durationMonths === 1 ? "mes" : "meses"}`;
}

export default function SubscriptionPricing() {
  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="page-subscription-pricing">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Tag className="h-7 w-7 text-primary" />
          Suscripción y cupones
        </h1>
        <p className="text-muted-foreground">Precio vigente de la suscripción y cupones de descuento.</p>
      </div>

      <Tabs defaultValue="precio">
        <TabsList>
          <TabsTrigger value="precio" data-testid="tab-precio">Precio</TabsTrigger>
          <TabsTrigger value="cupones" data-testid="tab-cupones">Cupones</TabsTrigger>
        </TabsList>
        <TabsContent value="precio" className="space-y-6 pt-4">
          <PriceTab />
        </TabsContent>
        <TabsContent value="cupones" className="space-y-6 pt-4">
          <CouponsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PriceTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<PriceResponse>({ queryKey: ["/api/admin/subscription-price"] });

  const [newPrice, setNewPrice] = useState("");
  const [appliesTo, setAppliesTo] = useState<PriceChangeScope>("new_only");
  const [effectiveAt, setEffectiveAt] = useState("");

  const mutation = useGuardedMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/subscription-price", {
        newPriceArs: Number(newPrice),
        appliesTo,
        ...(appliesTo === "all" ? { effectiveAt: new Date(effectiveAt).toISOString() } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscription-price"] });
      toast({ title: "Precio actualizado" });
      setNewPrice("");
      setAppliesTo("new_only");
      setEffectiveAt("");
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo actualizar el precio", description: err.message, variant: "destructive" });
    },
  });

  // Mínimo 30 días en el futuro como valor por defecto sugerido — el documento pide "por
  // defecto, dentro de 30 días", el input date igual deja elegir cualquier fecha futura.
  const defaultEffectiveAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <Card data-testid="card-current-price">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Precio actual
          </CardTitle>
          <CardDescription>Lo que paga una consultora que se suscribe hoy.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Cargando…</p>
          ) : (
            <p className="text-3xl font-bold" data-testid="text-current-price">
              {formatPrice(data?.currentPriceArs ?? 0)} <span className="text-sm font-normal text-muted-foreground">ARS / mes</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Cambiar el precio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="input-new-price">Precio nuevo (ARS)</Label>
            <Input
              id="input-new-price"
              type="number"
              min={1}
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="20000"
              data-testid="input-new-price"
            />
          </div>

          <RadioGroup value={appliesTo} onValueChange={(v) => setAppliesTo(v as PriceChangeScope)} className="space-y-3">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="new_only" id="radio-new-only" data-testid="radio-applies-new-only" />
              <Label htmlFor="radio-new-only" className="font-normal leading-tight">
                Solo a las nuevas suscripciones
                <span className="block text-xs text-muted-foreground">Las que ya pagan mantienen su precio.</span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="all" id="radio-all" data-testid="radio-applies-all" />
              <Label htmlFor="radio-all" className="font-normal leading-tight">
                También a las suscripciones actuales
                <span className="block text-xs text-muted-foreground">Elegís desde qué fecha empieza a regir para las ya suscriptas.</span>
              </Label>
            </div>
          </RadioGroup>

          {appliesTo === "all" && (
            <div className="space-y-1.5 pl-6">
              <Label htmlFor="input-effective-at">Rige desde</Label>
              <Input
                id="input-effective-at"
                type="date"
                value={effectiveAt || defaultEffectiveAt}
                onChange={(e) => setEffectiveAt(e.target.value)}
                data-testid="input-effective-at"
              />
            </div>
          )}

          <Button
            onClick={() => mutation.mutate()}
            disabled={!newPrice || Number(newPrice) <= 0 || mutation.isPending}
            data-testid="button-save-price"
          >
            Guardar precio
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Historial de cambios</CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.history.length ? (
            <p className="text-sm text-muted-foreground">Todavía no se registró ningún cambio de precio.</p>
          ) : (
            <Table data-testid="table-price-history">
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Precio anterior</TableHead>
                  <TableHead>Precio nuevo</TableHead>
                  <TableHead>A quiénes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.history.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{formatDate(entry.changedAt)}</TableCell>
                    <TableCell>{entry.oldPriceArs !== null ? formatPrice(entry.oldPriceArs) : "—"}</TableCell>
                    <TableCell className="font-medium">{formatPrice(entry.newPriceArs)}</TableCell>
                    <TableCell>
                      {entry.appliesTo === "new_only" ? (
                        "Solo nuevas"
                      ) : (
                        <>
                          Todas, desde {formatDate(entry.effectiveAt)}
                          {!entry.appliedAt && <Badge variant="outline" className="ml-2">Pendiente de aplicar</Badge>}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CouponsTab() {
  const { toast } = useToast();
  const { data: coupons, isLoading } = useQuery<CouponRow[]>({ queryKey: ["/api/admin/coupons"] });
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const toggleActiveMutation = useGuardedMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/coupons/${id}`, { active });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/coupons"] });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo actualizar el cupón", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)} data-testid="button-create-coupon">
          <Plus className="h-4 w-4 mr-1.5" />
          Crear cupón
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-muted-foreground">Cargando…</p>
          ) : !coupons?.length ? (
            <p className="text-sm text-muted-foreground">Todavía no creaste ningún cupón.</p>
          ) : (
            <Table data-testid="table-coupons">
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Descuento</TableHead>
                  <TableHead>Usos</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Duración</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Activo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coupons.map((coupon) => {
                  const status = couponStatus(coupon);
                  return (
                    <TableRow
                      key={coupon.id}
                      className="cursor-pointer"
                      onClick={() => setDetailId(coupon.id)}
                      data-testid={`row-coupon-${coupon.code}`}
                    >
                      <TableCell className="font-mono font-medium">{coupon.code}</TableCell>
                      <TableCell>{discountLabel(coupon)}</TableCell>
                      <TableCell>{coupon.maxUses !== null ? `${coupon.activeUses} de ${coupon.maxUses}` : `${coupon.activeUses}`}</TableCell>
                      <TableCell>{formatDate(coupon.expiresAt)}</TableCell>
                      <TableCell>{durationLabel(coupon)}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={coupon.active}
                          onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: coupon.id, active: checked })}
                          data-testid={`switch-active-${coupon.code}`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateCouponDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CouponDetailDialog couponId={detailId} onOpenChange={(open) => !open && setDetailId(null)} />
    </div>
  );
}

function CreateCouponDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<CouponDiscountType>("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [duration, setDuration] = useState<CouponDuration>("forever");
  const [durationMonths, setDurationMonths] = useState("3");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const reset = () => {
    setCode("");
    setDiscountType("percentage");
    setDiscountValue("");
    setDuration("forever");
    setDurationMonths("3");
    setMaxUses("");
    setExpiresAt("");
  };

  const mutation = useGuardedMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/coupons", {
        code,
        discountType,
        discountValue: Number(discountValue),
        duration,
        ...(duration === "months" ? { durationMonths: Number(durationMonths) } : {}),
        ...(maxUses ? { maxUses: Number(maxUses) } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/coupons"] });
      toast({ title: "Cupón creado" });
      reset();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo crear el cupón", description: err.message, variant: "destructive" });
    },
  });

  const valid = code.trim().length >= 3 && !code.includes(" ") && Number(discountValue) > 0 && (duration !== "months" || Number(durationMonths) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-coupon">
        <DialogHeader>
          <DialogTitle>Crear cupón</DialogTitle>
          <DialogDescription>El código se guarda en mayúsculas automáticamente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="input-coupon-code">Código</Label>
            <Input
              id="input-coupon-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ""))}
              placeholder="CONSULTORA123"
              data-testid="input-coupon-code"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo de descuento</Label>
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as CouponDiscountType)}>
                <SelectTrigger data-testid="select-discount-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Porcentaje (%)</SelectItem>
                  <SelectItem value="fixed">Monto fijo ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="input-discount-value">Valor</Label>
              <Input
                id="input-discount-value"
                type="number"
                min={1}
                max={discountType === "percentage" ? 100 : undefined}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === "percentage" ? "50" : "10000"}
                data-testid="input-discount-value"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Duración del descuento</Label>
            <Select value={duration} onValueChange={(v) => setDuration(v as CouponDuration)}>
              <SelectTrigger data-testid="select-duration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="first_payment">Solo el primer pago</SelectItem>
                <SelectItem value="months">Una cantidad de meses</SelectItem>
                <SelectItem value="forever">Para siempre</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {duration === "months" && (
            <div className="space-y-1.5">
              <Label htmlFor="input-duration-months">Cantidad de meses</Label>
              <Input
                id="input-duration-months"
                type="number"
                min={1}
                value={durationMonths}
                onChange={(e) => setDurationMonths(e.target.value)}
                data-testid="input-duration-months"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="input-max-uses">Límite de usos (opcional)</Label>
              <Input
                id="input-max-uses"
                type="number"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="Sin límite"
                data-testid="input-max-uses"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="input-coupon-expires">Vence el (opcional)</Label>
              <Input
                id="input-coupon-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                data-testid="input-coupon-expires"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending} data-testid="button-save-coupon">
            Crear cupón
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CouponDetailResponse {
  coupon: CouponRow;
  redemptions: {
    redemption: { id: number; status: string; reservedAt: string; confirmedAt: string | null; discountEndsAt: string | null };
    consultantId: number;
    businessName: string;
    username: string;
  }[];
}

function CouponDetailDialog({ couponId, onOpenChange }: { couponId: number | null; onOpenChange: (open: boolean) => void }) {
  const { data } = useQuery<CouponDetailResponse>({
    queryKey: [`/api/admin/coupons/${couponId}`],
    enabled: couponId !== null,
  });

  return (
    <Dialog open={couponId !== null} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-coupon-detail">
        <DialogHeader>
          <DialogTitle className="font-mono">{data?.coupon.code}</DialogTitle>
          <DialogDescription>
            {data ? `${discountLabel(data.coupon)} · ${durationLabel(data.coupon)}` : "Cargando…"}
          </DialogDescription>
        </DialogHeader>
        {data && (
          <div className="space-y-3">
            {!data.redemptions.length ? (
              <p className="text-sm text-muted-foreground">Todavía nadie usó este cupón.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Consultora</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Suscripta</TableHead>
                    <TableHead>Hasta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.redemptions.map((r) => (
                    <TableRow key={r.redemption.id}>
                      <TableCell>{r.businessName || r.username}</TableCell>
                      <TableCell>
                        <Badge variant={r.redemption.status === "confirmed" ? "default" : "outline"}>
                          {r.redemption.status === "confirmed" ? "Confirmado" : r.redemption.status === "reserved" ? "Reservado" : "Liberado"}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(r.redemption.confirmedAt)}</TableCell>
                      <TableCell>{formatDate(r.redemption.discountEndsAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
