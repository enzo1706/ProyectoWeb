import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/MetricCard";
import { ErrorBlock } from "@/components/ErrorBlock";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { ClientDetailSheet } from "@/components/ClientDetailSheet";
import type { Client } from "@/components/ClientCard";
import { apiRequest } from "@/lib/queryClient";
import { useHideMoney } from "@/hooks/use-hide-money";
import { toDateStr, parseLocalDate } from "@/lib/date";
import { REPORT_PERIOD_KINDS, type ReportPeriodKind } from "@shared/reportsPeriods";
import { DollarSign, TrendingUp, Wallet, Inbox, ArrowUp, ArrowDown, Minus } from "lucide-react";

/** Forma de respuesta de GET /api/reports/overview — ver server/storage.ts (ReportsOverview). */
interface ReportsOverview {
  totalSales: number;
  totalProfit: number;
  hasIncompleteCostData: boolean;
  previousTotalSales: number | null;
  previousTotalProfit: number | null;
  comparisonPeriod: { start: string; end: string; truncated: boolean };
  distinctClientCount: number;
  totalSalesToClients: number;
  averagePurchasePerClient: number | null;
  pendingBalanceToday: number;
  overdueBalanceToday: number;
}
interface TopProductRow {
  productId: number | null;
  productName: string;
  category: string;
  imagen: string | null;
  quantitySold: number;
  totalSales: number;
}
interface TopClientRow {
  clientId: number;
  clientName: string;
  purchaseCount: number;
  totalAmount: number;
  productCount: number;
}
interface InactiveClientRow {
  clientId: number;
  name: string | null;
  phone: string | null;
  lastPurchase: string | null;
  daysSinceLastPurchase: number | null;
  totalPurchased: number;
}

const RECONTACT_THRESHOLD_DAYS = 60;

const periodLabels: Record<ReportPeriodKind, string> = {
  this_month: "Este mes",
  last_month: "El mes pasado",
  last_3_months: "Últimos 3 meses",
  this_week: "Esta semana",
  custom: "Personalizado",
};

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/** Rango [start, end) para cada botón rápido — siempre en hora LOCAL del navegador (correcto
 * para una consultora en Argentina, sin necesidad de ningún ajuste: `Date` ya usa la zona
 * horaria del dispositivo, nunca UTC, a diferencia del servidor). */
function computePeriodRange(kind: ReportPeriodKind, customStart: string, customEnd: string): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (kind) {
    case "this_week": {
      const monday = startOfWeek(now);
      const nextMonday = new Date(monday);
      nextMonday.setDate(monday.getDate() + 7);
      return { start: toDateStr(monday), end: toDateStr(nextMonday) };
    }
    case "last_month":
      return { start: toDateStr(new Date(year, month - 1, 1)), end: toDateStr(new Date(year, month, 1)) };
    case "last_3_months":
      return { start: toDateStr(new Date(year, month - 3, 1)), end: toDateStr(new Date(year, month, 1)) };
    case "custom":
      if (!customStart || !customEnd || customEnd < customStart) return { start: "", end: "" };
      return { start: customStart, end: toDateStr(new Date(parseLocalDate(customEnd).getTime() + 86400000)) };
    case "this_month":
    default:
      return { start: toDateStr(new Date(year, month, 1)), end: toDateStr(new Date(year, month + 1, 1)) };
  }
}

function formatRangeLabel(start: string, endExclusive: string): string {
  const startDate = parseLocalDate(start);
  const endInclusive = parseLocalDate(toDateStr(new Date(parseLocalDate(endExclusive).getTime() - 86400000)));
  const sameMonth = startDate.getMonth() === endInclusive.getMonth() && startDate.getFullYear() === endInclusive.getFullYear();
  if (sameMonth) {
    return `${startDate.getDate()} al ${endInclusive.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}`;
  }
  return `${startDate.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} al ${endInclusive.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Texto de la línea de comparación — ver docs/prompts-mejoras.md (Prompt 11, decisiones). */
function comparisonLabel(kind: ReportPeriodKind, comparisonPeriod: { start: string }): string {
  const monthName = parseLocalDate(comparisonPeriod.start).toLocaleDateString("es-MX", { month: "long" });
  switch (kind) {
    case "this_month":
      return `mismos días de ${monthName}`;
    case "this_week":
      return "mismos días de la semana pasada";
    case "last_month":
      return monthName;
    case "last_3_months":
      return "los 3 meses anteriores";
    default:
      return "el período anterior";
  }
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center" data-testid="report-empty">
      <Inbox className="h-8 w-8 text-muted-foreground mb-2" />
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  );
}

function ComparisonLine({
  current,
  previous,
  label,
  format,
}: {
  current: number;
  previous: number | null;
  label: string;
  format: (n: number) => string;
}) {
  if (previous === null || previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  const Icon = pct > 0 ? ArrowUp : pct < 0 ? ArrowDown : Minus;
  const color = pct > 0 ? "text-green-600 dark:text-green-500" : pct < 0 ? "text-red-600 dark:text-red-500" : "text-muted-foreground";
  return (
    <p className={`text-xs font-medium flex items-center gap-1 mt-1.5 ${color}`} data-testid="comparison-line">
      <Icon className="h-3 w-3 shrink-0" />
      <span>{pct > 0 ? "+" : ""}{pct}% vs. {label}</span>
    </p>
  );
}

export default function Reportes() {
  const { format } = useHideMoney();
  const [, setLocation] = useLocation();
  const [periodKind, setPeriodKind] = useState<ReportPeriodKind>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);

  const { start, end } = useMemo(() => computePeriodRange(periodKind, customStart, customEnd), [periodKind, customStart, customEnd]);
  const hasValidRange = Boolean(start && end);
  const rangeLabel = hasValidRange ? formatRangeLabel(start, end) : "";

  const overviewQuery = useQuery<ReportsOverview>({
    queryKey: ["/api/reports/overview", periodKind, start, end],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/overview?period=${periodKind}&start=${start}&end=${end}`);
      return res.json();
    },
    enabled: hasValidRange,
  });

  const topProductsQuery = useQuery<TopProductRow[]>({
    queryKey: ["/api/reports/top-products", start, end, showAllProducts],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/top-products?start=${start}&end=${end}&limit=${showAllProducts ? 10 : 5}`);
      return res.json();
    },
    enabled: hasValidRange,
  });

  const topClientsQuery = useQuery<TopClientRow[]>({
    queryKey: ["/api/reports/top-clients", start, end],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/top-clients?start=${start}&end=${end}&limit=5`);
      return res.json();
    },
    enabled: hasValidRange,
  });

  // "Clientas para recontactar": reusa el mismo endpoint que Inicio (días fijos en 60, sin
  // selector) — inactive-clients incluye a las que NUNCA compraron (lastPurchase null), que
  // acá no corresponden ("al menos una compra"), así que se filtran y se reordenan del lado
  // del cliente, sin tocar el endpoint compartido.
  const inactiveClientsQuery = useQuery<InactiveClientRow[]>({
    queryKey: ["/api/reports/inactive-clients", RECONTACT_THRESHOLD_DAYS],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/inactive-clients?days=${RECONTACT_THRESHOLD_DAYS}`);
      return res.json();
    },
  });

  const clientsToRecontact = useMemo(
    () =>
      (inactiveClientsQuery.data ?? [])
        .filter((c) => c.lastPurchase !== null)
        // Las que hace MENOS tiempo que no compran primero (recién pasaron los 2 meses).
        .sort((a, b) => (a.daysSinceLastPurchase ?? 0) - (b.daysSinceLastPurchase ?? 0))
        .slice(0, 5),
    [inactiveClientsQuery.data],
  );

  const selectedClientQuery = useQuery<Client>({
    queryKey: ["/api/clients", selectedClientId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${selectedClientId}`);
      return res.json();
    },
    enabled: selectedClientId !== null,
  });

  const isEmptyPeriod = overviewQuery.data?.totalSales === 0;

  const executiveSummary = useMemo(() => {
    if (!overviewQuery.data || isEmptyPeriod) return null;
    const bestProduct = topProductsQuery.data?.[0] ?? null;
    const bestClient = topClientsQuery.data?.[0] ?? null;
    const profitPer100 = overviewQuery.data.totalSales > 0 ? Math.round((overviewQuery.data.totalProfit / overviewQuery.data.totalSales) * 100) : 0;
    return { bestProduct, bestClient, profitPer100 };
  }, [overviewQuery.data, isEmptyPeriod, topProductsQuery.data, topClientsQuery.data]);

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="page-reportes">
      <div>
        <h1 className="text-3xl font-bold">Reportes</h1>
        {hasValidRange && <p className="text-muted-foreground mt-1" data-testid="text-period-range">{rangeLabel}</p>}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
        {REPORT_PERIOD_KINDS.map((kind) => (
          <Button
            key={kind}
            variant={periodKind === kind ? "default" : "outline"}
            size="sm"
            className="shrink-0"
            onClick={() => setPeriodKind(kind)}
            data-testid={`button-period-${kind}`}
          >
            {periodLabels[kind]}
          </Button>
        ))}
      </div>

      {periodKind === "custom" && (
        <div className="grid grid-cols-2 gap-2 max-w-sm">
          <div className="space-y-1">
            <Label htmlFor="report-custom-start" className="sr-only">Desde</Label>
            <Input id="report-custom-start" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} data-testid="input-custom-start" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="report-custom-end" className="sr-only">Hasta</Label>
            <Input id="report-custom-end" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} data-testid="input-custom-end" />
          </div>
        </div>
      )}

      {periodKind === "custom" && !hasValidRange ? (
        <EmptyBlock message="Elegí una fecha de inicio y de fin para ver el reporte." />
      ) : overviewQuery.isError ? (
        <ErrorBlock error={overviewQuery.error as Error} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {overviewQuery.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-lg" />)
            ) : (
              <>
                <div className="sm:col-span-1">
                  <MetricCard title="Vendiste" value={format(overviewQuery.data?.totalSales ?? 0)} icon={DollarSign} />
                  {overviewQuery.data && (
                    <ComparisonLine
                      current={overviewQuery.data.totalSales}
                      previous={overviewQuery.data.previousTotalSales}
                      label={comparisonLabel(periodKind, overviewQuery.data.comparisonPeriod)}
                      format={format}
                    />
                  )}
                </div>
                <div>
                  <MetricCard
                    title="Ganaste"
                    value={`${overviewQuery.data?.hasIncompleteCostData ? "≈ " : ""}${format(overviewQuery.data?.totalProfit ?? 0)}`}
                    icon={TrendingUp}
                  />
                  {overviewQuery.data && (
                    <ComparisonLine
                      current={overviewQuery.data.totalProfit}
                      previous={overviewQuery.data.previousTotalProfit}
                      label={comparisonLabel(periodKind, overviewQuery.data.comparisonPeriod)}
                      format={format}
                    />
                  )}
                </div>
                <div>
                  <MetricCard
                    title="Te deben hoy"
                    value={format(overviewQuery.data?.pendingBalanceToday ?? 0)}
                    icon={Wallet}
                    onClick={() => setLocation("/clientas?filter=pendiente_pago")}
                  />
                  {(overviewQuery.data?.overdueBalanceToday ?? 0) > 0 && (
                    <p className="text-xs font-medium text-destructive mt-1.5" data-testid="text-overdue">
                      de eso, {format(overviewQuery.data!.overdueBalanceToday)} ya venció
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {overviewQuery.isLoading ? null : isEmptyPeriod ? (
            <EmptyBlock message="Todavía no hay ventas en este período." />
          ) : executiveSummary && overviewQuery.data ? (
            <div className="rounded-lg border bg-muted p-4 text-sm leading-relaxed" data-testid="executive-summary">
              <p>
                Este período vendiste <strong className="font-semibold">{format(overviewQuery.data.totalSales)}</strong> a{" "}
                <strong className="font-semibold">{overviewQuery.data.distinctClientCount}</strong> clienta
                {overviewQuery.data.distinctClientCount !== 1 ? "s" : ""}.
                {executiveSummary.bestProduct && (
                  <> Tu producto más vendido fue <strong className="font-semibold">{executiveSummary.bestProduct.productName}</strong></>
                )}
                {executiveSummary.bestClient && (
                  <> y tu mejor clienta, <strong className="font-semibold">{executiveSummary.bestClient.clientName}</strong></>
                )}
                . De cada $ 100 que vendiste, ganaste $ {executiveSummary.profitPer100}.
              </p>
            </div>
          ) : null}

          {!isEmptyPeriod && overviewQuery.data?.averagePurchasePerClient !== null && overviewQuery.data?.averagePurchasePerClient !== undefined && (
            <Card data-testid="card-average-purchase">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Compra promedio por clienta</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{format(overviewQuery.data.averagePurchasePerClient)}</p>
                <p className="text-xs text-muted-foreground mt-1">Lo que gastó en promedio cada clienta en este período</p>
              </CardContent>
            </Card>
          )}

          <Card data-testid="card-top-products">
            <CardHeader>
              <CardTitle className="text-lg">Productos más vendidos</CardTitle>
            </CardHeader>
            <CardContent>
              {topProductsQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-md" />)}
                </div>
              ) : topProductsQuery.isError ? (
                <ErrorBlock error={topProductsQuery.error as Error} />
              ) : !topProductsQuery.data?.length ? (
                <EmptyBlock message="No se vendió ningún producto en este período." />
              ) : (
                <>
                  <div className="space-y-3">
                    {topProductsQuery.data.map((product, i) => {
                      const maxQuantity = topProductsQuery.data![0].quantitySold || 1;
                      const barWidth = Math.max(4, Math.round((product.quantitySold / maxQuantity) * 100));
                      return (
                        <div key={`${product.productId}-${i}`} className="relative" data-testid={`row-top-product-${i}`}>
                          <div
                            className="absolute inset-y-0 left-0 rounded-md bg-primary/10"
                            style={{ width: `${barWidth}%` }}
                            aria-hidden
                          />
                          <div className="relative flex items-center gap-3 px-2 py-1.5">
                            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate text-sm">{product.productName}</p>
                              <Badge variant="secondary" className="text-[10px] mt-0.5">{product.category}</Badge>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-medium">{product.quantitySold} un.</p>
                              <p className="text-xs text-muted-foreground tabular-nums">{format(product.totalSales)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {!showAllProducts && topProductsQuery.data.length >= 5 && (
                    <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setShowAllProducts(true)} data-testid="button-show-all-products">
                      Ver todos
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-top-clients">
            <CardHeader>
              <CardTitle className="text-lg">Mejores clientas</CardTitle>
            </CardHeader>
            <CardContent>
              {topClientsQuery.isLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-md" />)}
                </div>
              ) : topClientsQuery.isError ? (
                <ErrorBlock error={topClientsQuery.error as Error} />
              ) : !topClientsQuery.data?.length ? (
                <EmptyBlock message="No hay compras registradas en este período." />
              ) : (
                <div className="space-y-4">
                  {topClientsQuery.data.map((client, i) => (
                    <button
                      key={client.clientId}
                      type="button"
                      className="flex items-center gap-4 w-full text-left hover-elevate rounded-md p-1 -m-1"
                      onClick={() => setSelectedClientId(client.clientId)}
                      data-testid={`row-top-client-${client.clientId}`}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{client.clientName}</p>
                        <p className="text-sm text-muted-foreground">{client.purchaseCount} compra{client.purchaseCount !== 1 ? "s" : ""}</p>
                      </div>
                      <p className="font-medium tabular-nums shrink-0">{format(client.totalAmount)}</p>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-recontact">
            <CardHeader>
              <CardTitle className="text-lg">Clientas para recontactar</CardTitle>
            </CardHeader>
            <CardContent>
              {inactiveClientsQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-md" />)}
                </div>
              ) : inactiveClientsQuery.isError ? (
                <ErrorBlock error={inactiveClientsQuery.error as Error} />
              ) : !clientsToRecontact.length ? (
                <EmptyBlock message="No hay clientas para recontactar." />
              ) : (
                <>
                  <div className="space-y-3">
                    {clientsToRecontact.map((client) => (
                      <div key={client.clientId} className="flex items-center gap-3" data-testid={`row-recontact-${client.clientId}`}>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{client.name ?? client.phone ?? "Sin nombre"}</p>
                          <p className="text-sm text-muted-foreground">Última compra: hace {client.daysSinceLastPurchase} días</p>
                        </div>
                        <WhatsAppButton phone={client.phone} variant="icon" />
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => setLocation("/clientas?filter=no_compran_hace")}
                    data-testid="button-view-all-recontact"
                  >
                    Ver todas
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ClientDetailSheet
        open={selectedClientId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedClientId(null);
        }}
        client={selectedClientQuery.data ?? null}
        onEdit={() => setLocation("/clientas")}
        onNewSale={() => setLocation("/clientas")}
      />
    </div>
  );
}
