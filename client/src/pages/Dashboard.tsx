import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { LowStockDialog } from "@/components/LowStockDialog";
import { ErrorBlock } from "@/components/ErrorBlock";
import { AppointmentDetailDialog } from "@/components/AppointmentDetailDialog";
import { SaleDetailDialog } from "@/components/SaleDetailDialog";
import { CompleteProfileDialog } from "@/components/CompleteProfileDialog";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { useSaleDialog } from "@/hooks/use-sale-dialog";
import { useHideMoney } from "@/hooks/use-hide-money";
import { isReminderActive } from "@shared/stockAlerts";
import { getEventTypeLabel } from "@/components/AppointmentCard";
import { setOrderReminderPreload } from "@/lib/orderReminderPreload";
import { getArgentinaDateStr } from "@shared/argentinaTime";
import type { Product, Appointment, DashboardNoticeType } from "@shared/schema";
import {
  Plus,
  Clock,
  Calendar,
  CalendarDays,
  Package,
  Gift,
  Users,
  Truck,
  Target,
  PartyPopper,
  ShoppingBag,
  PackagePlus,
  UserX,
  AlertTriangle,
  X,
  type LucideIcon,
} from "lucide-react";

// Forma de /api/dashboard/overview — server-only, se replica acá como contrato de API (mismo
// criterio que ya usaba esta pantalla para los endpoints de /api/reports/*). Ver
// DashboardOverview en server/storage.ts.
interface PendingInstallmentRow {
  saleId: number;
  installmentId: number;
  clientName: string;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  isOverdue: boolean;
}
interface OrderReminderItemRow {
  productId: number;
  productName: string;
  soldInPeriod: number;
  pendingFromBefore: number;
  currentStock: number;
  suggestedQuantity: number;
}
interface DeliveryReadyRow {
  saleId: number;
  itemId: number;
  clientId: number | null;
  clientName: string;
  productName: string;
  quantity: number;
}
interface DashboardOverview {
  businessName: string;
  monthlyGoal: number | null;
  monthSales: number;
  daysLeftInMonth: number;
  paraHacerHoy: {
    deliveryReady: DeliveryReadyRow[];
    orderReminder: { reminder: { id: number; reminderDate: string }; items: OrderReminderItemRow[] } | null;
    appointmentsToday: Appointment[];
    birthdaysToday: { clientId: number; name: string | null; phone: string | null }[];
  };
  pendientes: {
    installments: PendingInstallmentRow[];
    unfinishedSalesCount: number;
    unfinishedOrdersCount: number;
    salesWithoutClientCount: number;
  };
  paraMejorarTuNegocio: {
    limitePlanGratis: boolean;
    stockBajo: { count: number; products: Product[] } | null;
    clientasInactivas: { count: number } | null;
    productosSinCosto: { count: number } | null;
    clientasSinCelular: { count: number } | null;
    completarPerfil: boolean;
  };
}

interface TaskItem {
  key: string;
  icon: LucideIcon;
  colorClass: string;
  title: string;
  subtitle: string;
  actions: ReactNode;
}

const BLOCK_MAX_VISIBLE = 3;

function formatDateDisplay(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "long" });
}

function TaskRow({ task }: { task: TaskItem }) {
  const Icon = task.icon;
  return (
    <div className="flex items-center gap-3 py-2.5" data-testid={`task-row-${task.key}`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${task.colorClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold text-foreground">{task.title}</p>
        {task.subtitle && <p className="break-words text-sm text-muted-foreground">{task.subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{task.actions}</div>
    </div>
  );
}

/** Cada bloque se oculta si no tiene avisos y muestra hasta BLOCK_MAX_VISIBLE, con "Ver más"
 * para el resto (Prompt 10, punto 7). */
function NoticeBlock({ title, icon: Icon, testId, items }: { title: string; icon: LucideIcon; testId: string; items: TaskItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const visible = expanded ? items : items.slice(0, BLOCK_MAX_VISIBLE);
  const remaining = items.length - visible.length;

  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {visible.map((task) => (
          <TaskRow key={task.key} task={task} />
        ))}
        {remaining > 0 && (
          <button
            type="button"
            className="w-full py-2 text-center text-sm text-muted-foreground underline"
            onClick={() => setExpanded(true)}
            data-testid={`button-${testId}-ver-mas`}
          >
            Ver más ({remaining})
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function DismissButton({ noticeType, onDismiss }: { noticeType: DashboardNoticeType; onDismiss: (type: DashboardNoticeType) => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 text-muted-foreground"
      onClick={() => onDismiss(noticeType)}
      aria-label="Ocultar este aviso"
      title="Ocultar este aviso"
      data-testid={`button-dismiss-notice-${noticeType}`}
    >
      <X className="h-4 w-4" />
    </Button>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { format } = useHideMoney();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { openCreateSale } = useSaleDialog();

  const { data: overview, isLoading, isError } = useQuery<DashboardOverview>({
    queryKey: ["/api/dashboard/overview"],
  });
  const businessName = overview?.businessName || user?.username;

  const [lowStockOpen, setLowStockOpen] = useState(false);
  const [appointmentDetailOpen, setAppointmentDetailOpen] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [completeProfileOpen, setCompleteProfileOpen] = useState(false);
  const [confirmPayInstallment, setConfirmPayInstallment] = useState<PendingInstallmentRow | null>(null);
  const [showAllReminderItems, setShowAllReminderItems] = useState(false);

  const invalidateOverview = () => queryClient.invalidateQueries({ queryKey: ["/api/dashboard/overview"] });

  const markDeliveredMutation = useGuardedMutation({
    mutationFn: async (itemId: number) => {
      const item = overview?.paraHacerHoy.deliveryReady.find((i) => i.itemId === itemId);
      const res = await apiRequest("PATCH", `/api/sales/${item?.saleId}/items/${itemId}/deliver`);
      return res.json();
    },
    onSuccess: () => {
      invalidateOverview();
      queryClient.invalidateQueries({ queryKey: ["/api/sales"] });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo marcar como entregado", description: err.message, variant: "destructive" });
    },
  });

  const dismissReminderMutation = useGuardedMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/order-reminder/${id}/dismiss`);
      return res.json();
    },
    onSuccess: () => {
      invalidateOverview();
      setShowAllReminderItems(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo cerrar el recordatorio", description: err.message, variant: "destructive" });
    },
  });

  // Prompt 10, punto 1 — "Cobrada" registra un pago por el SALDO de esa cuota, con la misma
  // lógica de "Registrar pago" del Prompt 9 (client_payments + payment_allocations en la misma
  // transacción, PATCH /api/sales/:id/installments/:installmentId → registerInstallmentPayment
  // → applyPaymentToInstallments) — nunca cambia el estado a mano por otro camino.
  const payInstallmentMutation = useGuardedMutation({
    mutationFn: async (inst: PendingInstallmentRow) => {
      const res = await apiRequest("PATCH", `/api/sales/${inst.saleId}/installments/${inst.installmentId}`, { status: "pagado" });
      return res.json();
    },
    onSuccess: () => {
      invalidateOverview();
      queryClient.invalidateQueries({ queryKey: ["/api/sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({
        predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/reports"),
      });
      setConfirmPayInstallment(null);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo registrar el cobro", description: err.message, variant: "destructive" });
      setConfirmPayInstallment(null);
    },
  });

  const dismissNoticeMutation = useGuardedMutation({
    mutationFn: async (noticeType: DashboardNoticeType) => {
      await apiRequest("POST", `/api/dashboard/notices/${noticeType}/dismiss`);
    },
    onSuccess: () => invalidateOverview(),
    onError: (err: Error) => {
      toast({ title: "No se pudo ocultar el aviso", description: err.message, variant: "destructive" });
    },
  });
  const handleDismissNotice = (type: DashboardNoticeType) => dismissNoticeMutation.mutate(type);

  const openOrderForReminder = () => {
    const reminder = overview?.paraHacerHoy.orderReminder;
    if (!reminder) return;
    const qtyByProduct: Record<number, number> = {};
    for (const item of reminder.items) qtyByProduct[item.productId] = item.suggestedQuantity;
    setOrderReminderPreload(qtyByProduct);
    setLocation("/productos");
  };

  const detailAppointment = overview?.paraHacerHoy.appointmentsToday.find((a) => a.id === selectedAppointmentId) ?? null;
  const openAppointmentDetail = (appointment: Appointment) => {
    setSelectedAppointmentId(appointment.id);
    setAppointmentDetailOpen(true);
  };

  // Bloque "Para hacer hoy" — el recordatorio del día de pedido tiene su propia tarjeta rica
  // (lista + 2 botones, ver más abajo), nunca un TaskRow genérico.
  const paraHacerHoyItems = useMemo<TaskItem[]>(() => {
    if (!overview) return [];
    const items: TaskItem[] = [];
    for (const item of overview.paraHacerHoy.deliveryReady) {
      items.push({
        key: `delivery-${item.itemId}`,
        icon: Truck,
        colorClass: "bg-green-500/10 text-green-600 dark:text-green-400",
        title:
          item.clientId === null
            ? `Ya podés entregar: ${item.productName} x${item.quantity} (venta sin clienta)`
            : `Ya podés entregarle a ${item.clientName}`,
        subtitle: item.clientId === null ? "" : `${item.productName} x${item.quantity}`,
        actions: (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => markDeliveredMutation.mutate(item.itemId)}
            data-testid={`button-task-action-delivery-${item.itemId}`}
          >
            Marcar como entregado
          </Button>
        ),
      });
    }
    for (const apt of overview.paraHacerHoy.appointmentsToday) {
      items.push({
        key: `event-${apt.id}`,
        icon: Calendar,
        colorClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
        title: `Hoy a las ${apt.time} hs: ${getEventTypeLabel(apt.type)} con ${apt.clientName}`,
        subtitle: "",
        actions: (
          <Button type="button" variant="outline" size="sm" onClick={() => openAppointmentDetail(apt)} data-testid={`button-task-action-event-${apt.id}`}>
            Ver
          </Button>
        ),
      });
    }
    for (const b of overview.paraHacerHoy.birthdaysToday) {
      items.push({
        key: `birthday-${b.clientId}`,
        icon: Gift,
        colorClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
        title: `Hoy cumple ${b.name ?? b.phone ?? "Sin nombre"} 🎂`,
        subtitle: "",
        actions: <WhatsAppButton phone={b.phone} variant="icon" />,
      });
    }
    return items;
  }, [overview, markDeliveredMutation]);

  // Bloque "Pendientes".
  const pendientesItems = useMemo<TaskItem[]>(() => {
    if (!overview) return [];
    const items: TaskItem[] = [];
    for (const inst of overview.pendientes.installments) {
      items.push({
        key: `installment-${inst.installmentId}`,
        icon: Clock,
        colorClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        title: `${inst.clientName} te debe ${format(inst.amount)} (${inst.isOverdue ? `venció el ${formatDateDisplay(inst.dueDate)}` : "vence hoy"})`,
        subtitle: "",
        actions: (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirmPayInstallment(inst)}
            data-testid={`button-task-action-installment-${inst.installmentId}`}
          >
            Cobrada
          </Button>
        ),
      });
    }
    if (overview.pendientes.unfinishedSalesCount > 0) {
      const n = overview.pendientes.unfinishedSalesCount;
      items.push({
        key: "unfinished-sales",
        icon: ShoppingBag,
        colorClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
        title: `Tenés ${n} venta${n !== 1 ? "s" : ""} sin terminar`,
        subtitle: "",
        actions: (
          <Button type="button" variant="outline" size="sm" onClick={() => setLocation("/ventas")} data-testid="button-task-action-unfinished-sales">
            Retomar
          </Button>
        ),
      });
    }
    if (overview.pendientes.unfinishedOrdersCount > 0) {
      const n = overview.pendientes.unfinishedOrdersCount;
      items.push({
        key: "unfinished-orders",
        icon: PackagePlus,
        colorClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
        title: `Tenés ${n} pedido${n !== 1 ? "s" : ""} sin terminar`,
        subtitle: "",
        actions: (
          <Button type="button" variant="outline" size="sm" onClick={() => setLocation("/productos")} data-testid="button-task-action-unfinished-orders">
            Retomar
          </Button>
        ),
      });
    }
    if (overview.pendientes.salesWithoutClientCount > 0) {
      const n = overview.pendientes.salesWithoutClientCount;
      items.push({
        key: "sales-without-client",
        icon: UserX,
        colorClass: "bg-muted text-muted-foreground",
        title: `Tenés ${n} venta${n !== 1 ? "s" : ""} sin clienta`,
        subtitle: "",
        actions: (
          <Button type="button" variant="outline" size="sm" onClick={() => setLocation("/ventas")} data-testid="button-task-action-sales-without-client">
            Asignar clienta
          </Button>
        ),
      });
    }
    return items;
  }, [overview, format]);

  // Bloque "Para mejorar tu negocio" — orden fijo (ajuste del Prompt 10): límite del plan
  // gratis primero, los 4 del prompt original después, "Completá tu perfil" al final.
  const paraMejorarTuNegocioItems = useMemo<TaskItem[]>(() => {
    if (!overview) return [];
    const items: TaskItem[] = [];
    const m = overview.paraMejorarTuNegocio;
    if (m.limitePlanGratis) {
      items.push({
        key: "free-plan-limit",
        icon: AlertTriangle,
        colorClass: "bg-destructive/10 text-destructive",
        title: "Llegaste al límite de la prueba gratis. Suscribite para cargar todos los productos que quieras.",
        subtitle: "",
        actions: (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setLocation("/subscription")} data-testid="button-task-action-free-plan-limit">
              Ver planes
            </Button>
            <DismissButton noticeType="limite_plan_gratis" onDismiss={handleDismissNotice} />
          </>
        ),
      });
    }
    if (m.stockBajo) {
      items.push({
        key: "stock-bajo",
        icon: Package,
        colorClass: "bg-destructive/10 text-destructive",
        title: `${m.stockBajo.count} producto${m.stockBajo.count !== 1 ? "s" : ""} con poco stock`,
        subtitle: "",
        actions: (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setLowStockOpen(true)} data-testid="button-task-action-stock-bajo">
              Ver
            </Button>
            <DismissButton noticeType="stock_bajo" onDismiss={handleDismissNotice} />
          </>
        ),
      });
    }
    if (m.clientasInactivas) {
      items.push({
        key: "clientas-inactivas",
        icon: Users,
        colorClass: "bg-muted text-muted-foreground",
        title: `${m.clientasInactivas.count} clienta${m.clientasInactivas.count !== 1 ? "s" : ""} hace más de 2 meses que no compran`,
        subtitle: "",
        actions: (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLocation("/clientas?filter=no_compran_hace")}
              data-testid="button-task-action-clientas-inactivas"
            >
              Ver
            </Button>
            <DismissButton noticeType="clientas_inactivas" onDismiss={handleDismissNotice} />
          </>
        ),
      });
    }
    if (m.productosSinCosto) {
      items.push({
        key: "productos-sin-costo",
        icon: Package,
        colorClass: "bg-muted text-muted-foreground",
        title: `Tenés ${m.productosSinCosto.count} producto${m.productosSinCosto.count !== 1 ? "s" : ""} sin costo cargado`,
        subtitle: "",
        actions: (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setLocation("/productos")} data-testid="button-task-action-productos-sin-costo">
              Completarlos
            </Button>
            <DismissButton noticeType="productos_sin_costo" onDismiss={handleDismissNotice} />
          </>
        ),
      });
    }
    if (m.clientasSinCelular) {
      items.push({
        key: "clientas-sin-celular",
        icon: Users,
        colorClass: "bg-muted text-muted-foreground",
        title: `Tenés ${m.clientasSinCelular.count} clienta${m.clientasSinCelular.count !== 1 ? "s" : ""} sin celular cargado`,
        subtitle: "",
        actions: (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setLocation("/clientas")} data-testid="button-task-action-clientas-sin-celular">
              Completar
            </Button>
            <DismissButton noticeType="clientas_sin_celular" onDismiss={handleDismissNotice} />
          </>
        ),
      });
    }
    if (m.completarPerfil) {
      items.push({
        key: "completar-perfil",
        icon: Users,
        colorClass: "bg-muted text-muted-foreground",
        title: "Completá tu perfil para que te conozcamos mejor.",
        subtitle: "",
        actions: (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setCompleteProfileOpen(true)} data-testid="button-task-action-completar-perfil">
              Completar
            </Button>
            <DismissButton noticeType="completar_perfil" onDismiss={handleDismissNotice} />
          </>
        ),
      });
    }
    return items;
  }, [overview]);

  const hasNothing =
    !isLoading &&
    !isError &&
    !overview?.paraHacerHoy.orderReminder &&
    paraHacerHoyItems.length === 0 &&
    pendientesItems.length === 0 &&
    paraMejorarTuNegocioItems.length === 0;

  const monthlyGoal = overview?.monthlyGoal ?? null;
  const monthSales = overview?.monthSales ?? 0;
  const goalReached = monthlyGoal !== null && monthSales >= monthlyGoal;
  const goalProgressPct = monthlyGoal && monthlyGoal > 0 ? Math.min(100, Math.round((monthSales / monthlyGoal) * 100)) : 0;

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

      {isError && (
        <ErrorBlock message="No pudimos cargar parte de tu información. Los datos de esta pantalla pueden estar incompletos — probá recargar la página." />
      )}

      {isLoading && (
        <Card data-testid="card-loading-tasks">
          <CardContent className="space-y-3 py-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      )}

      {!isLoading && overview?.paraHacerHoy.orderReminder && (
        <Card data-testid="card-order-reminder">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-muted-foreground" />
              {overview.paraHacerHoy.orderReminder.reminder.reminderDate === getArgentinaDateStr()
                ? "Hoy es tu día de pedido"
                : `Tu día de pedido fue el ${formatDateDisplay(overview.paraHacerHoy.orderReminder.reminder.reminderDate)}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Estos productos que vendiste tienen poco stock</p>
            <div className="space-y-1.5">
              {(showAllReminderItems ? overview.paraHacerHoy.orderReminder.items : overview.paraHacerHoy.orderReminder.items.slice(0, 5)).map((item) => (
                <div key={item.productId} className="flex items-center justify-between text-sm" data-testid={`row-order-reminder-${item.productId}`}>
                  <span className="break-words">{item.productName}</span>
                  <Badge variant="outline">Sugerido: {item.suggestedQuantity}</Badge>
                </div>
              ))}
            </div>
            {!showAllReminderItems && overview.paraHacerHoy.orderReminder.items.length > 5 && (
              <button
                type="button"
                className="text-sm text-muted-foreground underline"
                onClick={() => setShowAllReminderItems(true)}
                data-testid="button-order-reminder-view-all"
              >
                Ver todos
              </button>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" onClick={openOrderForReminder} data-testid="button-order-reminder-build">
                Armar pedido con estos productos
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={dismissReminderMutation.isPending}
                onClick={() => dismissReminderMutation.mutate(overview.paraHacerHoy.orderReminder!.reminder.id)}
                data-testid="button-order-reminder-dismiss"
              >
                Listo, ya lo pedí
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && <NoticeBlock title="Para hacer hoy" icon={Clock} testId="section-para-hacer-hoy" items={paraHacerHoyItems} />}
      {!isLoading && <NoticeBlock title="Pendientes" icon={AlertTriangle} testId="section-pendientes" items={pendientesItems} />}
      {!isLoading && (
        <NoticeBlock title="Para mejorar tu negocio" icon={Target} testId="section-para-mejorar" items={paraMejorarTuNegocioItems} />
      )}

      {hasNothing && (
        <Card data-testid="card-empty-state">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <PartyPopper className="h-9 w-9 text-muted-foreground" />
            <p className="text-sm text-muted-foreground" data-testid="text-empty-state">
              Estás al día. No tenés nada pendiente.
            </p>
          </CardContent>
        </Card>
      )}

      <Button
        type="button"
        size="lg"
        className="h-14 w-full text-base font-semibold"
        onClick={() => openCreateSale()}
        data-testid="button-register-sale"
      >
        <Plus className="mr-2 h-5 w-5" />
        Registrar venta
      </Button>

      <Card data-testid="card-monthly-goal">
        <CardContent className="space-y-2 py-5">
          {isLoading ? (
            <Skeleton className="h-8 w-40" />
          ) : isError ? (
            <p className="text-sm text-destructive" data-testid="text-monthly-goal-error">
              No se pudo calcular
            </p>
          ) : monthlyGoal === null ? (
            <>
              <p className="text-sm text-muted-foreground">Este mes vendiste</p>
              <p className="text-2xl font-bold text-foreground sm:text-3xl" data-testid="text-month-total">
                {format(monthSales)}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => setLocation("/configuracion")} data-testid="button-define-goal">
                Definir mi objetivo
              </Button>
            </>
          ) : goalReached ? (
            <>
              <p className="text-base font-semibold text-emerald-600 dark:text-emerald-400" data-testid="text-goal-reached">
                ¡Llegaste a tu objetivo del mes! 🎉
              </p>
              <p className="text-2xl font-bold text-foreground sm:text-3xl" data-testid="text-month-total">
                {format(monthSales)}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Tu objetivo del mes</p>
              <p className="text-2xl font-bold text-foreground sm:text-3xl" data-testid="text-goal-progress">
                Vas {format(monthSales)} de {format(monthlyGoal)}
              </p>
              <Progress value={goalProgressPct} data-testid="progress-monthly-goal" />
              <p className="text-sm text-muted-foreground" data-testid="text-goal-remaining">
                Te faltan {format(Math.max(0, monthlyGoal - monthSales))} · quedan {overview?.daysLeftInMonth ?? 0} día
                {(overview?.daysLeftInMonth ?? 0) !== 1 ? "s" : ""}
              </p>
            </>
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

      <LowStockDialog open={lowStockOpen} onOpenChange={setLowStockOpen} products={overview?.paraMejorarTuNegocio.stockBajo?.products ?? []} />
      <CompleteProfileDialog open={completeProfileOpen} onOpenChange={setCompleteProfileOpen} />
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

      <AlertDialog open={confirmPayInstallment !== null} onOpenChange={(open) => !open && setConfirmPayInstallment(null)}>
        <AlertDialogContent data-testid="dialog-confirm-pay-installment">
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿{confirmPayInstallment?.clientName} te pagó los {confirmPayInstallment ? format(confirmPayInstallment.amount) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>Se va a registrar como un pago, igual que "Registrar pago" en la ficha de la clienta.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-pay-installment">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={payInstallmentMutation.isPending}
              onClick={() => confirmPayInstallment && payInstallmentMutation.mutate(confirmPayInstallment)}
              data-testid="button-confirm-pay-installment"
            >
              Sí, me pagó
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
