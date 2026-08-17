import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LowStockDialog } from "@/components/LowStockDialog";
import { AppointmentDetailDialog } from "@/components/AppointmentDetailDialog";
import { SaleDetailDialog } from "@/components/SaleDetailDialog";
import { NewSaleDialog } from "@/components/NewSaleDialog";
import { formatPrice } from "@/lib/currency";
import { toDateStr } from "@/lib/date";
import type { Product, Appointment } from "@shared/schema";
import {
  Plus,
  Clock,
  Calendar,
  Package,
  Gift,
  MessageCircleHeart,
  PartyPopper,
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

const MAX_TASKS = 4;

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

export default function Dashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

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
    queryKey: ["/api/reports/inactive-clients", 30],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/reports/inactive-clients?days=30");
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

  const tasks = useMemo<TaskItem[]>(() => {
    const items: TaskItem[] = [];

    // 1) Cuotas vencidas o que vencen hoy — lo más urgente.
    for (const inst of pendingInstallments) {
      if (items.length >= MAX_TASKS) break;
      if (inst.isOverdue || inst.dueDate === today) {
        items.push({
          key: `installment-${inst.saleId}-${inst.installmentNumber}`,
          icon: Clock,
          colorClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          title: inst.isOverdue ? `Cuota de ${inst.clientName} está vencida` : `Cuota de ${inst.clientName} vence hoy`,
          subtitle: formatPrice(inst.amount),
          actionLabel: "Cobrada",
          onAction: () => setSelectedSaleId(inst.saleId),
        });
      }
    }

    // 2) Citas de hoy.
    for (const apt of upcomingAppointments) {
      if (items.length >= MAX_TASKS) break;
      if (apt.date === today) {
        items.push({
          key: `appointment-${apt.id}`,
          icon: Calendar,
          colorClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
          title: `Cita con ${apt.clientName}, ${apt.time} hs`,
          subtitle: apt.location || "Sin lugar especificado",
          actionLabel: "Ver",
          onAction: () => openAppointmentDetail(apt),
        });
      }
    }

    // 3) Stock crítico (el que menos unidades tiene).
    if (items.length < MAX_TASKS && lowStockProducts.length > 0) {
      const worst = [...lowStockProducts].sort((a, b) => a.unidades - b.unidades)[0];
      items.push({
        key: `low-stock-${worst.id}`,
        icon: Package,
        colorClass: "bg-destructive/10 text-destructive",
        title: "Se está por acabar",
        subtitle: `${worst.producto}, quedan ${worst.unidades}`,
        actionLabel: "Reponer",
        onAction: () => setLowStockOpen(true),
      });
    }

    // 4) Cumpleaños en los próximos 7 días.
    for (const b of upcomingBirthdays) {
      if (items.length >= MAX_TASKS) break;
      if (b.daysUntil <= 7) {
        items.push({
          key: `birthday-${b.clientId}`,
          icon: Gift,
          colorClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
          title: `Cumpleaños de ${b.name ?? b.phone}`,
          subtitle: b.daysUntil === 0 ? "Hoy" : b.daysUntil === 1 ? "Mañana" : `En ${b.daysUntil} días`,
          actionLabel: "Saludar",
          onAction: () => setLocation("/clientas"),
        });
      }
    }

    // 5) Si no hay nada urgente todavía, completar con sugerencias suaves: cumpleaños más
    // lejanos y clientas inactivas — igual que el "no hay nada urgente" del mockup.
    if (items.length === 0) {
      for (const b of upcomingBirthdays) {
        if (items.length >= MAX_TASKS) break;
        if (b.daysUntil > 7) {
          items.push({
            key: `birthday-soon-${b.clientId}`,
            icon: PartyPopper,
            colorClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
            title: `Cumpleaños de ${b.name ?? b.phone} esta semana`,
            subtitle: "Ofrecele algo especial",
            actionLabel: "Saludar",
            onAction: () => setLocation("/clientas"),
          });
        }
      }
      for (const c of inactiveClients) {
        if (items.length >= MAX_TASKS) break;
        items.push({
          key: `inactive-${c.clientId}`,
          icon: MessageCircleHeart,
          colorClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
          title: `Hace ${c.daysSinceLastPurchase ?? "muchos"} días no le vendés a ${c.name ?? c.phone}`,
          subtitle: "Podría ser un buen día para escribirle",
          actionLabel: "Contactar",
          onAction: () => setLocation("/clientas"),
        });
      }
    }

    return items;
  }, [pendingInstallments, upcomingAppointments, lowStockProducts, upcomingBirthdays, inactiveClients, today]);

  const isLoadingTasks =
    loadingInstallments || loadingAppointments || loadingLowStock || loadingBirthdays || loadingInactive;

  // Mientras carga, un título neutro — "Tenés el día libre" antes de tener los datos
  // reales sería afirmar algo que todavía no se sabe.
  const tasksTitle = isLoadingTasks ? "Para hoy" : tasks.length === 0 ? "Tenés el día libre de pendientes" : "Para hoy";

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
          Hola, {user?.username}
        </p>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground" data-testid="text-greeting-main">
          Así está tu negocio hoy
        </h1>
      </div>

      <Card data-testid="card-today-tasks">
        <CardHeader className="pb-2">
          <CardTitle className="text-base" data-testid="text-tasks-title">
            {tasksTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {isLoadingTasks ? (
            <div className="space-y-3 py-1">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground" data-testid="text-tasks-empty">
              No hay nada pendiente por ahora. ¡Buen momento para planear tu próxima venta!
            </p>
          ) : (
            tasks.map((task) => <TaskRow key={task.key} task={task} />)
          )}
        </CardContent>
      </Card>

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
                {formatPrice(monthTotal)}
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
