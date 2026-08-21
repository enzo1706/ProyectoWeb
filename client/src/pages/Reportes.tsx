import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/MetricCard";
import { apiRequest } from "@/lib/queryClient";
import { useHideMoney } from "@/hooks/use-hide-money";
import { toDateStr, parseLocalDate } from "@/lib/date";
import { chartTooltipStyle, colorForIndex } from "@/lib/chart-theme";
import { exportToCsv } from "@/lib/csv";
import {
  DollarSign,
  TrendingUp,
  Receipt,
  ShoppingBag,
  Inbox,
  AlertTriangle,
  Package,
  Clock,
  CalendarClock,
  CalendarCheck,
  CalendarX,
  Download,
  Printer,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// Formas de respuesta de los endpoints /api/reports/* (definidos en server/storage.ts,
// no importables desde el cliente por ser server-only — se replican acá como contrato de API).
interface SalesSummaryPoint {
  period: string;
  totalSales: number;
  totalProfit: number;
  salesCount: number;
  avgTicket: number;
}
interface TopProductRow {
  productId: number | null;
  productName: string;
  category: string;
  imagen: string | null;
  quantitySold: number;
  totalSales: number;
}
interface TopCategoryRow {
  category: string;
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
interface PaymentMethodRow {
  paymentMethod: string;
  salesCount: number;
  totalSales: number;
}
interface InstallmentsBreakdown {
  singlePayment: { salesCount: number; totalSales: number };
  financed: { salesCount: number; totalSales: number };
}
interface StockValuationData {
  valueAtCost: number;
  valueAtPrice: number;
  potentialProfit: number;
  productCount: number;
  unitCount: number;
}
interface InactiveClientRow {
  clientId: number;
  name: string | null;
  phone: string;
  lastPurchase: string | null;
  daysSinceLastPurchase: number | null;
  totalPurchased: number;
}
interface UpcomingBirthdayRow {
  clientId: number;
  name: string | null;
  phone: string;
  birthday: string;
  daysUntil: number;
}
interface AppointmentsSummaryData {
  pendiente: number;
  confirmada: number;
  completada: number;
  cancelada: number;
}
interface PendingInstallmentRow {
  saleId: number;
  clientName: string;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  isOverdue: boolean;
}

type PeriodPreset = "today" | "week" | "month" | "quarter" | "year" | "custom";
type GroupBy = "day" | "week" | "month";

const periodLabels: Record<PeriodPreset, string> = {
  today: "Hoy",
  week: "Esta semana",
  month: "Este mes",
  quarter: "Este trimestre",
  year: "Este año",
  custom: "Personalizado",
};

const paymentMethodLabels: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function computePresetRange(preset: PeriodPreset): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (preset) {
    case "today": {
      const start = toDateStr(now);
      const end = toDateStr(new Date(year, month, now.getDate() + 1));
      return { start, end };
    }
    case "week": {
      const monday = startOfWeek(now);
      const nextMonday = new Date(monday);
      nextMonday.setDate(monday.getDate() + 7);
      return { start: toDateStr(monday), end: toDateStr(nextMonday) };
    }
    case "quarter": {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return {
        start: toDateStr(new Date(year, quarterStartMonth, 1)),
        end: toDateStr(new Date(year, quarterStartMonth + 3, 1)),
      };
    }
    case "year":
      return { start: toDateStr(new Date(year, 0, 1)), end: toDateStr(new Date(year + 1, 0, 1)) };
    case "month":
    default:
      return { start: toDateStr(new Date(year, month, 1)), end: toDateStr(new Date(year, month + 1, 1)) };
  }
}

/** Período anterior equivalente: mismo largo/unidad de calendario, terminando justo donde arranca el actual. */
function computePreviousPeriod(preset: PeriodPreset, start: string, end: string): { start: string; end: string } {
  const startDate = parseLocalDate(start);
  let prevStartDate: Date;

  switch (preset) {
    case "today":
      prevStartDate = new Date(startDate.getTime() - 86400000);
      break;
    case "week":
      prevStartDate = new Date(startDate.getTime() - 7 * 86400000);
      break;
    case "month":
      prevStartDate = new Date(startDate.getFullYear(), startDate.getMonth() - 1, startDate.getDate());
      break;
    case "quarter":
      prevStartDate = new Date(startDate.getFullYear(), startDate.getMonth() - 3, startDate.getDate());
      break;
    case "year":
      prevStartDate = new Date(startDate.getFullYear() - 1, startDate.getMonth(), startDate.getDate());
      break;
    case "custom":
    default: {
      const days = Math.round((parseLocalDate(end).getTime() - startDate.getTime()) / 86400000);
      prevStartDate = new Date(startDate.getTime() - days * 86400000);
      break;
    }
  }

  return { start: toDateStr(prevStartDate), end: start };
}

function deriveGroupBy(start: string, end: string): GroupBy {
  const days = Math.round((parseLocalDate(end).getTime() - parseLocalDate(start).getTime()) / 86400000);
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

function formatPeriodLabel(period: string, groupBy: GroupBy): string {
  if (groupBy === "month") {
    const [y, m] = period.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
  }
  return parseLocalDate(period).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function summarizePoints(points: SalesSummaryPoint[]) {
  const totalSales = points.reduce((sum, p) => sum + p.totalSales, 0);
  const totalProfit = points.reduce((sum, p) => sum + p.totalProfit, 0);
  const salesCount = points.reduce((sum, p) => sum + p.salesCount, 0);
  const avgTicket = salesCount > 0 ? Math.round(totalSales / salesCount) : 0;
  return { totalSales, totalProfit, salesCount, avgTicket };
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center" data-testid="report-empty">
      <Inbox className="h-8 w-8 text-muted-foreground mb-2" />
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  );
}

function ErrorBlock({ error }: { error: Error }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
      data-testid="report-error"
    >
      <AlertTriangle className="h-6 w-6 text-destructive" />
      <p className="text-sm text-destructive">No se pudo cargar este reporte: {error.message}</p>
    </div>
  );
}

/** Fila compartida por los reportes de tipo lista (Mejores Clientas, Clientas Inactivas, Cumpleaños, Cuotas Pendientes). */
function ReportListRow({
  testId,
  leading,
  title,
  subtitle,
  right,
}: {
  testId?: string;
  leading?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4" data-testid={testId}>
      {leading}
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{title}</p>
        {subtitle}
      </div>
      <div className="text-right shrink-0">{right}</div>
    </div>
  );
}

function ExportButton({ onClick, testId }: { onClick: () => void; testId: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="shrink-0 print:hidden"
      onClick={onClick}
      data-testid={testId}
      title="Exportar CSV"
      aria-label="Exportar CSV"
    >
      <Download className="h-3.5 w-3.5" />
    </Button>
  );
}

/** Indicador de variación vs. el período anterior: diferencia absoluta, porcentual y flecha ↑ ↓ =. */
function TrendDelta({
  current,
  previous,
  format,
}: {
  current: number;
  previous: number;
  format: (n: number) => string;
}) {
  const diff = current - previous;
  const pct = previous !== 0 ? (diff / previous) * 100 : null;
  const Icon = diff > 0 ? ArrowUp : diff < 0 ? ArrowDown : Minus;
  const color = diff > 0 ? "text-green-600 dark:text-green-500" : diff < 0 ? "text-red-600 dark:text-red-500" : "text-muted-foreground";

  return (
    <p className={`text-xs font-medium flex flex-wrap items-center gap-1 mt-1.5 ${color}`} data-testid="trend-delta">
      <Icon className="h-3 w-3 shrink-0" />
      <span>{diff > 0 ? "+" : ""}{format(diff)}</span>
      {pct !== null && <span>({diff > 0 ? "+" : ""}{pct.toFixed(1)}%)</span>}
      <span className="text-muted-foreground font-normal">vs. período anterior</span>
    </p>
  );
}

export default function Reportes() {
  const { format } = useHideMoney();
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [inactiveDays, setInactiveDays] = useState(30);
  const [comparePeriod, setComparePeriod] = useState(false);

  const { start, end } = useMemo(() => {
    if (preset === "custom") {
      if (!customStart || !customEnd || customEnd < customStart) return { start: "", end: "" };
      const endExclusive = toDateStr(new Date(parseLocalDate(customEnd).getTime() + 86400000));
      return { start: customStart, end: endExclusive };
    }
    return computePresetRange(preset);
  }, [preset, customStart, customEnd]);

  const groupBy = useMemo(() => (start && end ? deriveGroupBy(start, end) : "day"), [start, end]);
  const hasValidRange = Boolean(start && end);

  const displayEnd = useMemo(
    () => (end ? toDateStr(new Date(parseLocalDate(end).getTime() - 86400000)) : ""),
    [end],
  );

  const previousPeriod = useMemo(
    () => (hasValidRange ? computePreviousPeriod(preset, start, end) : { start: "", end: "" }),
    [preset, start, end, hasValidRange],
  );

  const salesSummaryQuery = useQuery<SalesSummaryPoint[]>({
    queryKey: ["/api/reports/sales-summary", start, end, groupBy],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/sales-summary?start=${start}&end=${end}&groupBy=${groupBy}`);
      return res.json();
    },
    enabled: hasValidRange,
  });

  const previousSalesSummaryQuery = useQuery<SalesSummaryPoint[]>({
    queryKey: ["/api/reports/sales-summary", previousPeriod.start, previousPeriod.end, groupBy],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/reports/sales-summary?start=${previousPeriod.start}&end=${previousPeriod.end}&groupBy=${groupBy}`,
      );
      return res.json();
    },
    enabled: comparePeriod && hasValidRange && Boolean(previousPeriod.start),
  });

  const topProductsQuery = useQuery<TopProductRow[]>({
    queryKey: ["/api/reports/top-products", start, end],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/top-products?start=${start}&end=${end}&limit=5`);
      return res.json();
    },
    enabled: hasValidRange,
  });

  const topCategoriesQuery = useQuery<TopCategoryRow[]>({
    queryKey: ["/api/reports/top-categories", start, end],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/top-categories?start=${start}&end=${end}`);
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

  const paymentMethodsQuery = useQuery<PaymentMethodRow[]>({
    queryKey: ["/api/reports/payment-methods", start, end],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/payment-methods?start=${start}&end=${end}`);
      return res.json();
    },
    enabled: hasValidRange,
  });

  const installmentsQuery = useQuery<InstallmentsBreakdown>({
    queryKey: ["/api/reports/installments-breakdown", start, end],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/installments-breakdown?start=${start}&end=${end}`);
      return res.json();
    },
    enabled: hasValidRange,
  });

  // Reportes "foto del estado actual": no dependen del período elegido arriba.
  const stockValuationQuery = useQuery<StockValuationData>({
    queryKey: ["/api/reports/stock-valuation"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/reports/stock-valuation");
      return res.json();
    },
  });

  const inactiveClientsQuery = useQuery<InactiveClientRow[]>({
    queryKey: ["/api/reports/inactive-clients", inactiveDays],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/inactive-clients?days=${inactiveDays}`);
      return res.json();
    },
  });

  const upcomingBirthdaysQuery = useQuery<UpcomingBirthdayRow[]>({
    queryKey: ["/api/reports/upcoming-birthdays"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/reports/upcoming-birthdays?days=30");
      return res.json();
    },
  });

  const pendingInstallmentsQuery = useQuery<PendingInstallmentRow[]>({
    queryKey: ["/api/reports/pending-installments"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/reports/pending-installments");
      return res.json();
    },
  });

  // Este sí usa el período seleccionado arriba, como el resto de los reportes.
  const appointmentsSummaryQuery = useQuery<AppointmentsSummaryData>({
    queryKey: ["/api/reports/appointments-summary", start, end],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/appointments-summary?start=${start}&end=${end}`);
      return res.json();
    },
    enabled: hasValidRange,
  });

  const kpis = useMemo(() => summarizePoints(salesSummaryQuery.data ?? []), [salesSummaryQuery.data]);
  const previousKpis = useMemo(
    () => (previousSalesSummaryQuery.data ? summarizePoints(previousSalesSummaryQuery.data) : null),
    [previousSalesSummaryQuery.data],
  );

  const chartData = useMemo(
    () => (salesSummaryQuery.data ?? []).map((p) => ({ ...p, label: formatPeriodLabel(p.period, groupBy) })),
    [salesSummaryQuery.data, groupBy],
  );

  const summaryIsEmpty = salesSummaryQuery.data?.length === 0;

  const executiveSummary = useMemo(() => {
    if (summaryIsEmpty) return null;
    const bestCategory = (topCategoriesQuery.data ?? []).reduce<TopCategoryRow | null>(
      (best, c) => (!best || c.totalSales > best.totalSales ? c : best),
      null,
    );
    const bestClient = (topClientsQuery.data ?? []).reduce<TopClientRow | null>(
      (best, c) => (!best || c.totalAmount > best.totalAmount ? c : best),
      null,
    );
    const profitMargin = kpis.totalSales > 0 ? Math.round((kpis.totalProfit / kpis.totalSales) * 100) : 0;
    return { bestCategory, bestClient, profitMargin };
  }, [summaryIsEmpty, kpis, topCategoriesQuery.data, topClientsQuery.data]);

  const periodRangeLabel = hasValidRange
    ? `${parseLocalDate(start).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })} – ${parseLocalDate(displayEnd).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}`
    : "";

  const handleExportKpis = () => {
    exportToCsv(
      "reportes-kpis.csv",
      ["Métrica", "Valor"],
      [
        ["Período", `${periodLabels[preset]} (${periodRangeLabel})`],
        ["Ventas Totales", format(kpis.totalSales)],
        ["Ganancia Total", format(kpis.totalProfit)],
        ["Ticket Promedio", format(kpis.avgTicket)],
        ["Cantidad de Ventas", kpis.salesCount],
      ],
    );
  };

  const handleExportSales = () => {
    exportToCsv(
      "reportes-ventas.csv",
      ["Período", "Ventas", "Ganancia", "Cantidad de Ventas", "Ticket Promedio"],
      chartData.map((p) => [p.label, format(p.totalSales), format(p.totalProfit), p.salesCount, format(p.avgTicket)]),
    );
  };

  const handleExportProducts = () => {
    exportToCsv(
      "reportes-productos.csv",
      ["Producto", "Categoría", "Unidades Vendidas", "Ventas"],
      (topProductsQuery.data ?? []).map((p) => [p.productName, p.category, p.quantitySold, format(p.totalSales)]),
    );
  };

  const handleExportCategories = () => {
    exportToCsv(
      "reportes-categorias.csv",
      ["Categoría", "Unidades Vendidas", "Ventas"],
      (topCategoriesQuery.data ?? []).map((c) => [c.category, c.quantitySold, format(c.totalSales)]),
    );
  };

  const handleExportTopClients = () => {
    exportToCsv(
      "reportes-mejores-clientas.csv",
      ["Clienta", "Cantidad de Compras", "Total Comprado"],
      (topClientsQuery.data ?? []).map((c) => [c.clientName, c.purchaseCount, format(c.totalAmount)]),
    );
  };

  const handleExportPaymentMethods = () => {
    exportToCsv(
      "reportes-metodos-pago.csv",
      ["Método de Pago", "Cantidad de Ventas", "Total"],
      (paymentMethodsQuery.data ?? []).map((m) => [paymentMethodLabels[m.paymentMethod] ?? m.paymentMethod, m.salesCount, format(m.totalSales)]),
    );
  };

  const handleExportInstallmentsBreakdown = () => {
    if (!installmentsQuery.data) return;
    exportToCsv(
      "reportes-ventas-por-cuotas.csv",
      ["Tipo", "Cantidad de Ventas", "Total"],
      [
        ["Contado", installmentsQuery.data.singlePayment.salesCount, format(installmentsQuery.data.singlePayment.totalSales)],
        ["Financiado (2+ cuotas)", installmentsQuery.data.financed.salesCount, format(installmentsQuery.data.financed.totalSales)],
      ],
    );
  };

  const handleExportAppointmentsSummary = () => {
    if (!appointmentsSummaryQuery.data) return;
    exportToCsv(
      "reportes-agenda.csv",
      ["Estado", "Cantidad"],
      [
        ["Pendientes", appointmentsSummaryQuery.data.pendiente],
        ["Confirmadas", appointmentsSummaryQuery.data.confirmada],
        ["Realizadas", appointmentsSummaryQuery.data.completada],
        ["Canceladas", appointmentsSummaryQuery.data.cancelada],
      ],
    );
  };

  const handleExportStockValuation = () => {
    if (!stockValuationQuery.data) return;
    exportToCsv(
      "reportes-stock-valorizado.csv",
      ["Métrica", "Valor"],
      [
        ["Valor a Costo", format(stockValuationQuery.data.valueAtCost)],
        ["Valor a Venta", format(stockValuationQuery.data.valueAtPrice)],
        ["Ganancia Potencial", format(stockValuationQuery.data.potentialProfit)],
        ["Cantidad de Productos", stockValuationQuery.data.productCount],
        ["Cantidad de Unidades", stockValuationQuery.data.unitCount],
      ],
    );
  };

  const handleExportInactiveClients = () => {
    exportToCsv(
      "reportes-clientas-inactivas.csv",
      ["Clienta", "Teléfono", "Última Compra", "Días de Inactividad", "Total Histórico"],
      (inactiveClientsQuery.data ?? []).map((c) => [
        c.name ?? "",
        c.phone,
        c.lastPurchase ?? "Nunca compró",
        c.daysSinceLastPurchase ?? "",
        format(c.totalPurchased),
      ]),
    );
  };

  const handleExportBirthdays = () => {
    exportToCsv(
      "reportes-cumpleanos.csv",
      ["Clienta", "Teléfono", "Cumpleaños", "Días Restantes"],
      (upcomingBirthdaysQuery.data ?? []).map((c) => [c.name ?? "", c.phone, c.birthday, c.daysUntil]),
    );
  };

  const handleExportPendingInstallments = () => {
    exportToCsv(
      "reportes-cuotas-pendientes.csv",
      ["Clienta", "Cuota", "Vencimiento", "Monto", "Vencida"],
      (pendingInstallmentsQuery.data ?? []).map((r) => [r.clientName, r.installmentNumber, r.dueDate, format(r.amount), r.isOverdue ? "Sí" : "No"]),
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 print:p-0" data-testid="page-reportes">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Reportes</h1>
          <p className="text-muted-foreground">Análisis detallado de tu negocio</p>
          {hasValidRange && (
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-period-range">
              {periodLabels[preset]} · {periodRangeLabel}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 print:hidden">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Select value={preset} onValueChange={(v) => setPreset(v as PeriodPreset)}>
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(periodLabels) as PeriodPreset[]).map((key) => (
                  <SelectItem key={key} value={key}>{periodLabels[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preset === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="report-custom-start" className="sr-only">Desde</Label>
                  <Input
                    id="report-custom-start"
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    data-testid="input-custom-start"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="report-custom-end" className="sr-only">Hasta</Label>
                  <Input
                    id="report-custom-end"
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    data-testid="input-custom-end"
                  />
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="compare-toggle"
                checked={comparePeriod}
                onCheckedChange={setComparePeriod}
                data-testid="switch-compare-period"
              />
              <Label htmlFor="compare-toggle" className="text-sm cursor-pointer">
                Comparar con período anterior
              </Label>
            </div>
            <Button variant="outline" size="sm" onClick={handleExportKpis} data-testid="button-export-kpis">
              <Download className="h-4 w-4 mr-2" />
              Exportar KPIs
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print">
              <Printer className="h-4 w-4 mr-2" />
              Imprimir
            </Button>
          </div>
        </div>
      </div>

      {preset === "custom" && !hasValidRange ? (
        <EmptyBlock message="Elegí una fecha de inicio y de fin para ver el reporte." />
      ) : salesSummaryQuery.isError ? (
        <ErrorBlock error={salesSummaryQuery.error as Error} />
      ) : (
        <>
          {executiveSummary && (
            <div className="rounded-lg border bg-muted p-4 text-sm leading-relaxed" data-testid="executive-summary">
              <p>
                En el período seleccionado se registraron <strong className="font-semibold">{kpis.salesCount}</strong> venta{kpis.salesCount !== 1 ? "s" : ""} por un total de <strong className="font-semibold">{format(kpis.totalSales)}</strong>.
                {executiveSummary.bestCategory && <> La categoría con mejor desempeño fue <strong className="font-semibold">{executiveSummary.bestCategory.category}</strong>.</>}
                {executiveSummary.bestClient && <> La mejor clienta fue <strong className="font-semibold">{executiveSummary.bestClient.clientName}</strong>.</>}
                {" "}El ticket promedio fue de <strong className="font-semibold">{format(kpis.avgTicket)}</strong> y la rentabilidad promedio fue de <strong className="font-semibold">{executiveSummary.profitMargin}%</strong>.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {salesSummaryQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-lg" />)
            ) : (
              <>
                <div>
                  <MetricCard title="Ventas Totales" value={format(kpis.totalSales)} icon={DollarSign} />
                  {comparePeriod && previousKpis && (
                    <TrendDelta current={kpis.totalSales} previous={previousKpis.totalSales} format={format} />
                  )}
                </div>
                <div>
                  <MetricCard title="Ganancia Total" value={format(kpis.totalProfit)} icon={TrendingUp} />
                  {comparePeriod && previousKpis && (
                    <TrendDelta current={kpis.totalProfit} previous={previousKpis.totalProfit} format={format} />
                  )}
                </div>
                <div>
                  <MetricCard title="Ticket Promedio" value={format(kpis.avgTicket)} icon={Receipt} />
                  {comparePeriod && previousKpis && (
                    <TrendDelta current={kpis.avgTicket} previous={previousKpis.avgTicket} format={format} />
                  )}
                </div>
                <div>
                  <MetricCard title="Cantidad de Ventas" value={kpis.salesCount} icon={ShoppingBag} />
                  {comparePeriod && previousKpis && (
                    <TrendDelta current={kpis.salesCount} previous={previousKpis.salesCount} format={(n) => String(n)} />
                  )}
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="lg:col-span-2" data-testid="card-sales-trend">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-lg">Tendencia de Ventas y Ganancias</CardTitle>
                <ExportButton onClick={handleExportSales} testId="button-export-sales" />
              </CardHeader>
              <CardContent>
                {salesSummaryQuery.isLoading ? (
                  <Skeleton className="h-[300px] rounded-md" />
                ) : summaryIsEmpty ? (
                  <EmptyBlock message="No hay ventas registradas en este período." />
                ) : (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(140, 60%, 40%)" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(140, 60%, 40%)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => format(v)} width={80} />
                        <Tooltip
                          contentStyle={chartTooltipStyle}
                          formatter={(value: number, name: string) => [format(value), name === "totalSales" ? "Ventas" : "Ganancia"]}
                        />
                        <Area type="monotone" dataKey="totalSales" stroke="hsl(var(--primary))" fill="url(#salesGradient)" strokeWidth={2} />
                        <Area type="monotone" dataKey="totalProfit" stroke="hsl(140, 60%, 40%)" fill="url(#profitGradient)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card data-testid="card-category-breakdown">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-lg">Ventas por Categoría</CardTitle>
                <ExportButton onClick={handleExportCategories} testId="button-export-categories" />
              </CardHeader>
              <CardContent>
                {topCategoriesQuery.isLoading ? (
                  <Skeleton className="h-[250px] rounded-md" />
                ) : topCategoriesQuery.isError ? (
                  <ErrorBlock error={topCategoriesQuery.error as Error} />
                ) : !topCategoriesQuery.data?.length ? (
                  <EmptyBlock message="No hay ventas por categoría en este período." />
                ) : (
                  <>
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={topCategoriesQuery.data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={90}
                            paddingAngle={4}
                            dataKey="totalSales"
                            nameKey="category"
                            label={({ percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                            labelLine={false}
                          >
                            {topCategoriesQuery.data.map((entry, index) => (
                              <Cell key={entry.category} fill={colorForIndex(index)} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={chartTooltipStyle} formatter={(value: number) => [format(value), "Ventas"]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap justify-center gap-4 mt-2">
                      {topCategoriesQuery.data.map((cat, index) => (
                        <div key={cat.category} className="flex items-center gap-2 text-sm">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colorForIndex(index) }} />
                          <span className="text-muted-foreground">{cat.category}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-top-products">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-lg">Productos Más Vendidos</CardTitle>
                <ExportButton onClick={handleExportProducts} testId="button-export-products" />
              </CardHeader>
              <CardContent>
                {topProductsQuery.isLoading ? (
                  <Skeleton className="h-[250px] rounded-md" />
                ) : topProductsQuery.isError ? (
                  <ErrorBlock error={topProductsQuery.error as Error} />
                ) : !topProductsQuery.data?.length ? (
                  <EmptyBlock message="No se vendió ningún producto en este período." />
                ) : (
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topProductsQuery.data} layout="vertical">
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis
                          dataKey="productName"
                          type="category"
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={11}
                          width={110}
                          tickLine={false}
                          tickFormatter={(value: string) => (value.length > 16 ? `${value.slice(0, 15)}…` : value)}
                        />
                        <Tooltip contentStyle={chartTooltipStyle} formatter={(value: number) => [`${value} unidades`, "Vendidos"]} />
                        <Bar dataKey="quantitySold" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card data-testid="card-top-clients">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-lg">Mejores Clientas</CardTitle>
                <ExportButton onClick={handleExportTopClients} testId="button-export-top-clients" />
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
                      <ReportListRow
                        key={client.clientId}
                        testId={`row-top-client-${client.clientId}`}
                        leading={
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                            {i + 1}
                          </div>
                        }
                        title={client.clientName}
                        subtitle={
                          <p className="text-sm text-muted-foreground">
                            {client.purchaseCount} compra{client.purchaseCount !== 1 ? "s" : ""}
                          </p>
                        }
                        right={<p className="font-medium tabular-nums">{format(client.totalAmount)}</p>}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-payment-methods">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-lg">Ventas por Método de Pago</CardTitle>
                <ExportButton onClick={handleExportPaymentMethods} testId="button-export-payment-methods" />
              </CardHeader>
              <CardContent>
                {paymentMethodsQuery.isLoading ? (
                  <Skeleton className="h-[200px] rounded-md" />
                ) : paymentMethodsQuery.isError ? (
                  <ErrorBlock error={paymentMethodsQuery.error as Error} />
                ) : !paymentMethodsQuery.data?.length ? (
                  <EmptyBlock message="No hay ventas registradas en este período." />
                ) : (
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={paymentMethodsQuery.data.map((m) => ({ ...m, label: paymentMethodLabels[m.paymentMethod] ?? m.paymentMethod }))}
                        layout="vertical"
                      >
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis dataKey="label" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} width={90} tickLine={false} />
                        <Tooltip contentStyle={chartTooltipStyle} formatter={(value: number) => [format(value), "Ventas"]} />
                        <Bar dataKey="totalSales" radius={[0, 4, 4, 0]}>
                          {paymentMethodsQuery.data.map((entry, index) => (
                            <Cell key={entry.paymentMethod} fill={colorForIndex(index)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card data-testid="card-installments-breakdown">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-lg">Ventas por Cuotas</CardTitle>
              <ExportButton onClick={handleExportInstallmentsBreakdown} testId="button-export-installments-breakdown" />
            </CardHeader>
            <CardContent>
              {installmentsQuery.isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Skeleton className="h-20 rounded-md" />
                  <Skeleton className="h-20 rounded-md" />
                </div>
              ) : installmentsQuery.isError ? (
                <ErrorBlock error={installmentsQuery.error as Error} />
              ) : !installmentsQuery.data ||
                (installmentsQuery.data.singlePayment.salesCount === 0 && installmentsQuery.data.financed.salesCount === 0) ? (
                <EmptyBlock message="No hay ventas registradas en este período." />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground">Contado</p>
                    <p className="text-2xl font-bold tabular-nums mt-1">{format(installmentsQuery.data.singlePayment.totalSales)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {installmentsQuery.data.singlePayment.salesCount} venta{installmentsQuery.data.singlePayment.salesCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground">Financiado (2+ cuotas)</p>
                    <p className="text-2xl font-bold tabular-nums mt-1">{format(installmentsQuery.data.financed.totalSales)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {installmentsQuery.data.financed.salesCount} venta{installmentsQuery.data.financed.salesCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-appointments-summary">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-lg">Resumen de Citas</CardTitle>
              <ExportButton onClick={handleExportAppointmentsSummary} testId="button-export-appointments-summary" />
            </CardHeader>
            <CardContent>
              {appointmentsSummaryQuery.isLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-lg" />)}
                </div>
              ) : appointmentsSummaryQuery.isError ? (
                <ErrorBlock error={appointmentsSummaryQuery.error as Error} />
              ) : !appointmentsSummaryQuery.data ||
                Object.values(appointmentsSummaryQuery.data).every((n) => n === 0) ? (
                <EmptyBlock message="No hay citas registradas en este período." />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <MetricCard title="Pendientes" value={appointmentsSummaryQuery.data.pendiente} icon={Clock} />
                  <MetricCard title="Confirmadas" value={appointmentsSummaryQuery.data.confirmada} icon={CalendarClock} />
                  <MetricCard title="Realizadas" value={appointmentsSummaryQuery.data.completada} icon={CalendarCheck} />
                  <MetricCard title="Canceladas" value={appointmentsSummaryQuery.data.cancelada} icon={CalendarX} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-stock-valuation">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-lg">Stock Valorizado</CardTitle>
              <ExportButton onClick={handleExportStockValuation} testId="button-export-stock-valuation" />
            </CardHeader>
            <CardContent>
              {stockValuationQuery.isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-lg" />)}
                </div>
              ) : stockValuationQuery.isError ? (
                <ErrorBlock error={stockValuationQuery.error as Error} />
              ) : !stockValuationQuery.data || stockValuationQuery.data.productCount === 0 ? (
                <EmptyBlock message="No hay productos cargados." />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <MetricCard title="Valor a Costo" value={format(stockValuationQuery.data.valueAtCost)} icon={Package} />
                  <MetricCard title="Valor a Venta" value={format(stockValuationQuery.data.valueAtPrice)} icon={DollarSign} />
                  <MetricCard title="Ganancia Potencial" value={format(stockValuationQuery.data.potentialProfit)} icon={TrendingUp} />
                  <MetricCard title="Cantidad de Productos" value={stockValuationQuery.data.productCount} icon={ShoppingBag} />
                  <MetricCard title="Cantidad de Unidades" value={stockValuationQuery.data.unitCount} icon={Receipt} />
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card data-testid="card-inactive-clients">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-lg">Clientas Inactivas</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={String(inactiveDays)} onValueChange={(v) => setInactiveDays(Number(v))}>
                    <SelectTrigger className="w-[130px] print:hidden" data-testid="select-inactive-days">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 días</SelectItem>
                      <SelectItem value="60">60 días</SelectItem>
                      <SelectItem value="90">90 días</SelectItem>
                      <SelectItem value="180">180 días</SelectItem>
                    </SelectContent>
                  </Select>
                  <ExportButton onClick={handleExportInactiveClients} testId="button-export-inactive-clients" />
                </div>
              </CardHeader>
              <CardContent>
                {inactiveClientsQuery.isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-md" />)}
                  </div>
                ) : inactiveClientsQuery.isError ? (
                  <ErrorBlock error={inactiveClientsQuery.error as Error} />
                ) : !inactiveClientsQuery.data?.length ? (
                  <EmptyBlock message="No hay clientas inactivas en este rango." />
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                    {inactiveClientsQuery.data.map((client) => (
                      <ReportListRow
                        key={client.clientId}
                        testId={`row-inactive-client-${client.clientId}`}
                        title={client.name ?? client.phone}
                        subtitle={<p className="text-sm text-muted-foreground">{client.phone}</p>}
                        right={
                          <>
                            <p className="text-sm">
                              {client.lastPurchase ? `Hace ${client.daysSinceLastPurchase} días` : "Nunca compró"}
                            </p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              Histórico: {format(client.totalPurchased)}
                            </p>
                          </>
                        }
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-upcoming-birthdays">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-lg">Próximos Cumpleaños</CardTitle>
                <ExportButton onClick={handleExportBirthdays} testId="button-export-birthdays" />
              </CardHeader>
              <CardContent>
                {upcomingBirthdaysQuery.isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-md" />)}
                  </div>
                ) : upcomingBirthdaysQuery.isError ? (
                  <ErrorBlock error={upcomingBirthdaysQuery.error as Error} />
                ) : !upcomingBirthdaysQuery.data?.length ? (
                  <EmptyBlock message="No hay cumpleaños en los próximos 30 días." />
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                    {upcomingBirthdaysQuery.data.map((client) => (
                      <ReportListRow
                        key={client.clientId}
                        testId={`row-birthday-${client.clientId}`}
                        title={client.name ?? client.phone}
                        subtitle={<p className="text-sm text-muted-foreground">{client.phone}</p>}
                        right={
                          <>
                            <p className="text-sm font-medium">
                              {parseLocalDate(client.birthday).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {client.daysUntil === 0 ? "¡Hoy!" : `En ${client.daysUntil} día${client.daysUntil !== 1 ? "s" : ""}`}
                            </p>
                          </>
                        }
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card data-testid="card-pending-installments">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-lg">Cuotas Pendientes</CardTitle>
              <ExportButton onClick={handleExportPendingInstallments} testId="button-export-pending-installments" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
                Este reporte depende de la funcionalidad de administración de cuotas, prevista para una etapa posterior.
              </div>
              {pendingInstallmentsQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-md" />)}
                </div>
              ) : pendingInstallmentsQuery.isError ? (
                <ErrorBlock error={pendingInstallmentsQuery.error as Error} />
              ) : !pendingInstallmentsQuery.data?.length ? (
                <EmptyBlock message="No hay cuotas pendientes." />
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                  {pendingInstallmentsQuery.data.map((row) => (
                    <ReportListRow
                      key={`${row.saleId}-${row.installmentNumber}`}
                      testId={`row-pending-installment-${row.saleId}-${row.installmentNumber}`}
                      title={row.clientName}
                      subtitle={
                        <p className="text-sm text-muted-foreground">
                          Cuota {row.installmentNumber} · Vence {parseLocalDate(row.dueDate).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                        </p>
                      }
                      right={
                        <div className="flex flex-col items-end gap-1">
                          <p className="font-medium tabular-nums">{format(row.amount)}</p>
                          {row.isOverdue && <Badge variant="destructive">Vencida</Badge>}
                        </div>
                      }
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
