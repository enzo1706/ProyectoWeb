import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LowStockDialog } from "@/components/LowStockDialog";
import { AppointmentDetailDialog } from "@/components/AppointmentDetailDialog";
import { SaleDetailDialog } from "@/components/SaleDetailDialog";
import { NewSaleDialog } from "@/components/NewSaleDialog";
import { useHideMoney } from "@/hooks/use-hide-money";
import { toDateStr } from "@/lib/date";
import { isReminderActive } from "@shared/stockAlerts";
import { typeLabels } from "@/components/AppointmentCard";
import type { Product, Appointment, Consultant } from "@shared/schema";
import {
  Plus,
  Clock,
  Calendar,
  CalendarDays,
  Package,
  Gift,
  Users,
  type LucideIcon,
} from "lucide-react";

// Formas de respuesta de /api/reports/* — server-only, se replican acá como contrato de
// API (mismo criterio que ya usa Reportes.tsx para estos mismos endpoints).
interface PendingInstallmentRow {
  saleId: number;
  clientName: string;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  isOverdue: boolean;
}
interface UpcomingBirthdayRow {
  clientId: number;
  name: string | null;
  phone: string;
  birthday: string;
  daysUntil: number;
}
interface InactiveClientRow {
  clientId: number;
  name: string | null;
  phone: string;
  lastPurchase: string | null;
  daysSinceLastPurchase: number | null;
  totalPurchased: number;
}
interface SalesSummaryPoint {
  period: string;
  totalSales: number;
  totalProfit: number;
  salesCount: number;
  avgTicket: number;
}

interface TaskItem {
  key: string;
  icon: LucideIcon;
  colorClass: string;
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}

// Días hacia adelante que cubre la sección "Eventos próximos" y cuántos elementos como
// máximo muestra cada sección — así ninguna se convierte en una pantalla llena de texto.
const UPCOMING_EVENTS_DAYS = 7;
const INACTIVE_CLIENTS_DAYS = 60; // "más de 2 meses"
const SECTION_MAX_ITEMS = 5;

function currentMonthRange(): { start: string; end: string } {
  const now = new Date();
  return {
    start: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
  };
}

function previousMonthRange(): { start: string; end: string } {
  const now = new Date();
  return {
    start: toDateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    end: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
  };
}

function sumSales(points: SalesSummaryPoint[]): number {
  return points.reduce((sum, p) => sum + p.totalSales, 0);
}

function daysBetween(today: string, dateStr: string): number {
  const a = new Date(today + "T00:00:00");
  const b = new Date(dateStr + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function TaskRow({ task }: { task: TaskItem }) {
  const Icon = task.icon;
  return (
    <div className="flex items-center gap-3 py-2.5" data-testid={`task-row-${task.key}`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${task.colorClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{task.title}</p>
        <p className="truncate text-sm text-muted-foreground">{task.subtitle}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={task.onAction}
        data-testid={`button-task-action-${task.key}`}
      >
        {task.actionLabel}
      </Button>
    </div>
  );
}

/** Fila de alerta de stock bajo con la opción de posponerla — "Recordarme comprar". */
function StockAlertRow({
  product,
  onOpenLowStock,
  onSetReminder,
  isSettingReminder,
}: {
  product: Product;
  onOpenLowStock: () => void;
  onSetReminder: (productId: number, remindAt: string) => void;
  isSettingReminder: boolean;
}) {
  const [remindInput, setRemindInput] = useState("");
  const today = toDateStr(new Date());

  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5" data-testid={`task-row-low-stock-${product.id}`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <Package className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block truncate text-left text-sm font-semibold text-foreground hover:underline"
          onClick={onOpenLowStock}
          data-testid={`button-view-low-stock-${product.id}`}
        >
          {product.producto} tiene poco stock
        </button>
        <p className="truncate text-sm text-muted-foreground">
          Quedan {product.unidades} unidad{product.unidades !== 1 ? "es" : ""}
        </p>
      </div>
      <Input
        type="date"
        min={today}
        value={remindInput}
        onChange={(e) => setRemindInput(e.target.value)}
        className="h-8 w-[9.5rem] shrink-0 text-xs"
        aria-label={`Fecha para recordarme comprar ${product.producto}`}
        data-testid={`input-remind-date-${product.id}`}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={!remindInput || isSettingReminder}
        onClick={() => remindInput && onSetReminder(product.id, remindInput)}
        data-testid={`button-remind-${product.id}`}
      >
        Recordarme comprar
      </Button>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  testId,
  children,
}: {
  title: string;
  icon: LucideIcon;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y">{children}</CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { format } = useHideMoney();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: businessSettings } = useQuery<Consultant>({
    queryKey: ["/api/business-settings"],
  });
  const businessName = businessSettings?.businessName || user?.username;

  const [lowStockOpen, setLowStockOpen] = useState(false);
  const [appointmentDetailOpen, setAppointmentDetailOpen] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [newSaleOpen, setNewSaleOpen] = useState(false);

  const today = toDateStr(new Date());
  const { start: monthStart, end: monthEnd } = currentMonthRange();
  const { start: prevMonthStart, end: prevMonthEnd } = previousMonthRange();

  const { data: lowStockProducts = [], isLoading: loadingLowStock } = useQuery<Product[]>({
    queryKey: ["/api/products/low-stock"],
  });

  const { data: upcomingAppointments = [], isLoading: loadingAppointments } = useQuery<Appointment[]>({
    queryKey: ["/api/appointments/upcoming"],
  });

  const { data: pendingInstallments = [], isLoading: loadingInstallments } = useQuery<PendingInstallmentRow[]>({
    queryKey: ["/api/reports/pending-installments"],
  });

  const { data: upcomingBirthdays = [], isLoading: loadingBirthdays } = useQuery<UpcomingBirthdayRow[]>({
    queryKey: ["/api/reports/upcoming-birthdays", 30],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/reports/upcoming-birthdays?days=30");
      return res.json();
    },
  });

  const { data: inactiveClients = [], isLoading: loadingInactive } = useQuery<InactiveClientRow[]>({
    queryKey: ["/api/reports/inactive-clients", INACTIVE_CLIENTS_DAYS],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/inactive-clients?days=${INACTIVE_CLIENTS_DAYS}`);
      return res.json();
    },
  });

  const { data: currentMonthPoints = [], isLoading: loadingCurrentMonth } = useQuery<SalesSummaryPoint[]>({
    queryKey: ["/api/reports/sales-summary", monthStart, monthEnd],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/sales-summary?start=${monthStart}&end=${monthEnd}&groupBy=month`);
      return res.json();
    },
  });

  const { data: previousMonthPoints = [] } = useQuery<SalesSummaryPoint[]>({
    queryKey: ["/api/reports/sales-summary", prevMonthStart, prevMonthEnd],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/sales-summary?start=${prevMonthStart}&end=${prevMonthEnd}&groupBy=month`);
      return res.json();
    },
  });

  const { data: products = [] } = useQuery<Product[]>({ queryKey: ["/api/products"] });

  const detailAppointment = upcomingAppointments.find((a) => a.id === selectedAppointmentId) ?? null;

  const openAppointmentDetail = (appointment: Appointment) => {
    setSelectedAppointmentId(appointment.id);
    setAppointmentDetailOpen(true);
  };

  const [settingReminderId, setSettingReminderId] = useState<number | null>(null);
  const setReminderMutation = useGuardedMutation({
    mutationFn: async ({ productId, remindAt }: { productId: number; remindAt: string }) => {
      setSettingReminderId(productId);
      const res = await apiRequest("PATCH", `/api/products/${productId}/stock-reminder`, { remindAt });
      return res.json() as Promise<Product>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Te vamos a recordar comprarlo" });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo guardar el recordatorio", description: err.message, variant: "destructive" });
    },
    onSettled: () => setSettingReminderId(null),
  });

  // 1) Alertas importantes: cuotas vencidas/hoy + stock bajo (sin contar los productos con
  // un recordatorio activo todavía sin vencer — ver isReminderActive).
  const alertTasks = useMemo<TaskItem[]>(() => {
    const items: TaskItem[] = [];
    for (const inst of pendingInstallments) {
      items.push({
        key: `installment-${inst.saleId}-${inst.installmentNumber}`,
        icon: Clock,
        colorClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        title: inst.isOverdue ? `Cuota de ${inst.clientName} está vencida` : `Cuota de ${inst.clientName} vence hoy`,
        subtitle: format(inst.amount),
        actionLabel: "Cobrada",
        onAction: () => setSelectedSaleId(inst.saleId),
      });
    }
    return items.slice(0, SECTION_MAX_ITEMS);
  }, [pendingInstallments, format]);

  const stockAlertProducts = useMemo(
    () => lowStockProducts.filter((p) => !isReminderActive(p.remindStockAt, today)).slice(0, SECTION_MAX_ITEMS),
    [lowStockProducts, today],
  );

  // 2) Eventos próximos: los que caen dentro de los próximos N días (la API ya trae hasta
  // 10 futuros sin corte de fecha — acá se recorta a la ventana pedida).
  const upcomingEvents = useMemo(
    () =>
      upcomingAppointments
        .filter((a) => {
          const diff = daysBetween(today, a.date);
          return diff >= 0 && diff <= UPCOMING_EVENTS_DAYS;
        })
        .slice(0, SECTION_MAX_ITEMS),
    [upcomingAppointments, today],
  );

  // 3) Cumpleaños próximos (ya vienen ordenados por cercanía desde la API).
  const birthdaysToShow = useMemo(() => upcomingBirthdays.slice(0, SECTION_MAX_ITEMS), [upcomingBirthdays]);

  // 4) Clientas sin compras hace más de 2 meses.
  const inactiveToShow = useMemo(() => inactiveClients.slice(0, SECTION_MAX_ITEMS), [inactiveClients]);

  const isLoadingAny =
    loadingInstallments || loadingAppointments || loadingLowStock || loadingBirthdays || loadingInactive;

  const hasNothing =
    !isLoadingAny &&
    alertTasks.length === 0 &&
    stockAlertProducts.length === 0 &&
    upcomingEvents.length === 0 &&
    birthdaysToShow.length === 0 &&
    inactiveToShow.length === 0;

  const monthTotal = sumSales(currentMonthPoints);
  const prevMonthTotal = sumSales(previousMonthPoints);
  const trendText =
    prevMonthTotal > 0
      ? monthTotal > prevMonthTotal
        ? "Vas mejor que el mes pasado"
        : monthTotal < prevMonthTotal
          ? "Vendiste menos que el mes pasado"
          : "Igual que el mes pasado"
      : null;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-2xl mx-auto" data-testid="page-dashboard">
      <div>
        <p className="text-sm text-muted-foreground" data-testid="text-greeting-sub">
          Hola, {businessName}
        </p>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground" data-testid="text-greeting-main">
          Así está tu negocio hoy
        </h1>
      </div>

      {isLoadingAny && (
        <Card data-testid="card-loading-tasks">
          <CardContent className="space-y-3 py-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      )}

      {!isLoadingAny && (alertTasks.length > 0 || stockAlertProducts.length > 0) && (
        <Section title="Alertas importantes" icon={Clock} testId="section-alerts">
          {alertTasks.map((task) => (
            <TaskRow key={task.key} task={task} />
          ))}
          {stockAlertProducts.map((product) => (
            <StockAlertRow
              key={product.id}
              product={product}
              onOpenLowStock={() => setLowStockOpen(true)}
              onSetReminder={(productId, remindAt) => setReminderMutation.mutate({ productId, remindAt })}
              isSettingReminder={settingReminderId === product.id}
            />
          ))}
        </Section>
      )}

      {!isLoadingAny && upcomingEvents.length > 0 && (
        <Section title="Eventos próximos" icon={CalendarDays} testId="section-upcoming-events">
          {upcomingEvents.map((apt) => (
            <TaskRow
              key={apt.id}
              task={{
                key: `event-${apt.id}`,
                icon: Calendar,
                colorClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                title: `${apt.date === today ? "Hoy" : apt.date} · ${apt.time} hs — ${typeLabels[apt.type] ?? apt.type}`,
                subtitle: apt.clientName,
                actionLabel: "Ver",
                onAction: () => openAppointmentDetail(apt),
              }}
            />
          ))}
        </Section>
      )}

      {!isLoadingAny && birthdaysToShow.length > 0 && (
        <Section title="Cumpleaños" icon={Gift} testId="section-birthdays">
          {birthdaysToShow.map((b) => (
            <TaskRow
              key={b.clientId}
              task={{
                key: `birthday-${b.clientId}`,
                icon: Gift,
                colorClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
                title: b.name ?? b.phone,
                subtitle: b.daysUntil === 0 ? "Hoy" : b.daysUntil === 1 ? "Mañana" : `En ${b.daysUntil} días`,
                actionLabel: "Saludar",
                onAction: () => setLocation("/clientas"),
              }}
            />
          ))}
        </Section>
      )}

      {!isLoadingAny && inactiveToShow.length > 0 && (
        <Section title="Seguimiento de clientas" icon={Users} testId="section-inactive-clients">
          {inactiveToShow.map((c) => (
            <TaskRow
              key={c.clientId}
              task={{
                key: `inactive-${c.clientId}`,
                icon: Users,
                colorClass: "bg-muted text-muted-foreground",
                title: c.name ?? c.phone,
                subtitle:
                  c.daysSinceLastPurchase !== null
                    ? `Hace ${c.daysSinceLastPurchase} días sin comprarte`
                    : "Todavía no te compró",
                actionLabel: "Contactar",
                onAction: () => setLocation("/clientas"),
              }}
            />
          ))}
        </Section>
      )}

      {hasNothing && (
        <Card data-testid="card-empty-state">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <CalendarDays className="h-9 w-9 text-muted-foreground" />
            <p className="text-sm text-muted-foreground" data-testid="text-empty-state">
              No hay nada pendiente por ahora.
            </p>
            <Button type="button" variant="outline" onClick={() => setLocation("/agenda")} data-testid="button-go-agenda">
              Agendá tus próximas citas
            </Button>
          </CardContent>
        </Card>
      )}

      <Button
        type="button"
        size="lg"
        className="h-14 w-full text-base font-semibold"
        onClick={() => setNewSaleOpen(true)}
        data-testid="button-register-sale"
      >
        <Plus className="mr-2 h-5 w-5" />
        Registrar venta
      </Button>

      <Card data-testid="card-month-summary">
        <CardContent className="flex items-center justify-between gap-3 py-5">
          <div>
            <p className="text-sm text-muted-foreground">Este mes vendiste</p>
            {loadingCurrentMonth ? (
              <Skeleton className="mt-1 h-8 w-28" />
            ) : (
              <p className="text-2xl font-bold text-foreground sm:text-3xl" data-testid="text-month-total">
                {format(monthTotal)}
              </p>
            )}
          </div>
          {trendText && (
            <p className="text-right text-sm font-semibold text-emerald-600 dark:text-emerald-400" data-testid="text-month-trend">
              {trendText}
            </p>
          )}
        </CardContent>
      </Card>

      <button
        type="button"
        onClick={() => setLocation("/reportes")}
        className="block w-full text-center text-sm text-muted-foreground hover-elevate active-elevate-2 rounded-md py-2"
        data-testid="link-view-reports"
      >
        Ver todos los reportes
      </button>

      <LowStockDialog open={lowStockOpen} onOpenChange={setLowStockOpen} products={lowStockProducts} />
      <AppointmentDetailDialog
        open={appointmentDetailOpen}
        onOpenChange={(next) => {
          setAppointmentDetailOpen(next);
          if (!next) setSelectedAppointmentId(null);
        }}
        appointment={detailAppointment}
      />
      <SaleDetailDialog
        saleId={selectedSaleId}
        onOpenChange={(next) => {
          if (!next) setSelectedSaleId(null);
        }}
        onEdit={() => {
          setSelectedSaleId(null);
          setLocation("/ventas");
        }}
      />
      <NewSaleDialog open={newSaleOpen} onOpenChange={setNewSaleOpen} products={products} />
    </div>
  );
}
