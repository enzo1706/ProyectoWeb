import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AppointmentCard, type AppointmentWithPhone } from "@/components/AppointmentCard";
import { AppointmentDialog } from "@/components/AppointmentDialog";
import { AppointmentDetailDialog } from "@/components/AppointmentDetailDialog";
import { PayInstallmentConfirmDialog, type PayableInstallment } from "@/components/PayInstallmentConfirmDialog";
import { OrderReminderCard, type OrderReminderItemRow } from "@/components/OrderReminderCard";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, ChevronLeft, ChevronRight, CalendarX, ListFilter, Check, Wallet, Cake, Package, CalendarDays } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";
import { createAppointmentSchema } from "@shared/schema";
import { FIXED_EVENT_TYPES } from "@shared/eventTypes";
import { getEventTypeLabel, getEventTypeColorClass, getEventTypeIcon } from "@/components/AppointmentCard";
import { toDateStr, parseLocalDate } from "@/lib/date";
import { setOrderReminderPreload } from "@/lib/orderReminderPreload";
import { getArgentinaDateStr } from "@shared/argentinaTime";
import { cn } from "@/lib/utils";
import type { z } from "zod";

// Misma forma que usa AppointmentDialog para crear y editar (ver comentario ahí).
type AppointmentSavePayload = z.infer<typeof createAppointmentSchema>;

// Forma de /api/agenda/month — server-only, se replica acá como contrato de API (ver
// AgendaMonth/AgendaOrderDay en server/storage.ts).
interface PendingInstallmentRow {
  saleId: number;
  installmentId: number;
  clientName: string;
  clientPhone: string | null;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  isOverdue: boolean;
}
interface AgendaOrderDay {
  date: string;
  kind: "real" | "preview" | "marker";
  reminderId?: number;
  items?: OrderReminderItemRow[];
}
interface AgendaMonth {
  appointments: AppointmentWithPhone[];
  cobros: PendingInstallmentRow[];
  cumpleanos: { clientId: number; name: string | null; phone: string | null; day: number }[];
  diasDePedido: AgendaOrderDay[];
}

// Prompt 12, punto 4 — 4 grupos de color para los puntitos del calendario y la referencia de
// abajo (nunca un color por cada uno de los 9 tipos: ámbar/naranja, fucsia/rosa y celeste/azul
// se confundían entre sí). Colores sólidos (no la paleta suave bg-*-100 que usan los tipos de
// cita individuales) para que se note bien en una grilla chica.
const GROUP_COLORS = {
  cita: "bg-primary text-primary-foreground",
  cobro: "bg-green-500 text-white",
  cobroVencido: "bg-red-500 text-white",
  cumpleanos: "bg-yellow-400 text-yellow-950",
  diaPedido: "bg-blue-500 text-white",
};

const daysOfWeek = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function formatDateDisplay(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "long" });
}

/** Punto chico de un grupo (calendario) o chip con ícono (referencia de abajo). */
function GroupDot({ colorClass, icon: Icon, title, big = false }: { colorClass: string; icon: typeof Wallet; title: string; big?: boolean }) {
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full", colorClass, big ? "h-6 w-6" : "h-4 w-4")}
      title={title}
      data-testid={big ? undefined : `dot-${title}`}
    >
      <Icon className={big ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} />
    </div>
  );
}

export default function Agenda() {
  const { toast } = useToast();
  const { format } = useHideMoney();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string>(() => toDateStr(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [editingAppointment, setEditingAppointment] = useState<AppointmentWithPhone | null>(null);
  const [confirmPayInstallment, setConfirmPayInstallment] = useState<PayableInstallment | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStart = toDateStr(new Date(year, month, 1));
  const monthEnd = toDateStr(new Date(year, month + 1, 1));

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) calendarDays.push(null);
  for (let i = 1; i <= daysInMonth; i++) calendarDays.push(i);

  const { data: agendaMonth, isLoading, isError, error } = useQuery<AgendaMonth>({
    queryKey: ["/api/agenda/month", monthStart, monthEnd],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/agenda/month?start=${monthStart}&end=${monthEnd}`);
      return res.json();
    },
  });
  const appointments = agendaMonth?.appointments ?? [];
  const cobros = agendaMonth?.cobros ?? [];
  const cumpleanos = agendaMonth?.cumpleanos ?? [];
  const diasDePedido = agendaMonth?.diasDePedido ?? [];

  // Misma queryKey que usa AppointmentDialog para esto — comparten caché, un solo fetch.
  const { data: customTypes = [] } = useQuery<string[]>({
    queryKey: ["/api/appointments/custom-types"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/appointments/custom-types");
      return res.json();
    },
  });

  // Prompt 12, punto 8 — orden del filtro: "Todos los eventos", Cobros/Cumpleaños/Días de
  // pedido, los 6 tipos fijos, los personalizados al final. "Sacá Venta del filtro": los
  // retirados (RETIRED_EVENT_TYPES) nunca entran acá — una cita vieja con ese tipo se sigue
  // viendo bien en "Todos los eventos", simplemente no se puede volver a elegir ni filtrar sola.
  const AUTO_FILTER_VALUES = ["__cobros__", "__cumpleanos__", "__dias_pedido__"] as const;
  const filterOptions = useMemo(
    () => [
      { value: "__cobros__", label: "Cobros" },
      { value: "__cumpleanos__", label: "Cumpleaños" },
      { value: "__dias_pedido__", label: "Días de pedido" },
      ...FIXED_EVENT_TYPES,
      ...customTypes.filter((t) => !FIXED_EVENT_TYPES.some((f) => f.value === t)).map((t) => ({ value: t, label: t, colorClass: "" })),
    ],
    [customTypes],
  );
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const showAppointments = typeFilter === null || !AUTO_FILTER_VALUES.includes(typeFilter as typeof AUTO_FILTER_VALUES[number]);
  const filteredAppointments = useMemo(
    () => (typeFilter === null || AUTO_FILTER_VALUES.includes(typeFilter as typeof AUTO_FILTER_VALUES[number]) ? appointments : appointments.filter((a) => a.type === typeFilter)),
    [appointments, typeFilter],
  );
  const showCobros = typeFilter === null || typeFilter === "__cobros__";
  const showCumpleanos = typeFilter === null || typeFilter === "__cumpleanos__";
  const showDiasDePedido = typeFilter === null || typeFilter === "__dias_pedido__";
  // Si eligieron un tipo fijo/personalizado puntual, las citas de otros tipos no se muestran
  // (mismo criterio de siempre) y los 3 automáticos tampoco, salvo que el filtro sea uno de ellos.
  const appointmentsToShow = typeFilter !== null && AUTO_FILTER_VALUES.includes(typeFilter as typeof AUTO_FILTER_VALUES[number]) ? [] : filteredAppointments;

  // Se deriva de la lista en vivo (no un snapshot guardado al hacer click) para que el diálogo
  // de detalle siempre muestre el estado más reciente después de editar/cambiar estado.
  const detailAppointment = appointments.find((a) => a.id === selectedAppointmentId) ?? null;

  const invalidateMonth = () => queryClient.invalidateQueries({ queryKey: ["/api/agenda/month"] });

  const createMutation = useGuardedMutation({
    mutationFn: async (input: AppointmentSavePayload) => {
      const res = await apiRequest("POST", "/api/appointments", input);
      return res.json() as Promise<AppointmentWithPhone>;
    },
    onSuccess: () => {
      invalidateMonth();
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/custom-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/overview"] });
      setDialogOpen(false);
      toast({ title: "Cita creada correctamente" });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo crear la cita", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useGuardedMutation({
    mutationFn: async ({ id, input }: { id: number; input: AppointmentSavePayload }) => {
      const res = await apiRequest("PATCH", `/api/appointments/${id}`, input);
      return res.json() as Promise<AppointmentWithPhone>;
    },
    onSuccess: (updated) => {
      invalidateMonth();
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/custom-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/appointments-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/overview"] });
      if (editingAppointment?.clientId) {
        queryClient.invalidateQueries({ queryKey: ["/api/clients", editingAppointment.clientId, "appointments"] });
      }
      if (updated.clientId && updated.clientId !== editingAppointment?.clientId) {
        queryClient.invalidateQueries({ queryKey: ["/api/clients", updated.clientId, "appointments"] });
      }
      setDialogOpen(false);
      setEditingAppointment(null);
      toast({ title: "Cita actualizada correctamente" });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo actualizar la cita", description: err.message, variant: "destructive" });
    },
  });

  const dismissReminderMutation = useGuardedMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/order-reminder/${id}/dismiss`);
      return res.json();
    },
    onSuccess: () => invalidateMonth(),
    onError: (err: Error) => {
      toast({ title: "No se pudo cerrar el recordatorio", description: err.message, variant: "destructive" });
    },
  });

  const openOrderForReminder = (items: OrderReminderItemRow[]) => {
    const qtyByProduct: Record<number, number> = {};
    for (const item of items) qtyByProduct[item.productId] = item.suggestedQuantity;
    setOrderReminderPreload(qtyByProduct);
    window.location.assign("/productos");
  };

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const formatDateString = (day: number) => toDateStr(new Date(year, month, day));

  // Prompt 12, punto 4 — un punto por GRUPO presente ese día (nunca uno por cada cita/cobro
  // individual): hasta 4 puntos por día, uno por cada uno de "cita"/"cobro"/"cumpleaños"/
  // "día de pedido" — nunca se corta en 3 ni hace falta un "+N".
  const groupsForDay = (dateStr: string) => {
    const groups: { key: string; colorClass: string; icon: typeof Wallet; title: string }[] = [];
    if (appointmentsToShow.some((a) => a.date === dateStr)) {
      groups.push({ key: "cita", colorClass: GROUP_COLORS.cita, icon: CalendarDays, title: "Cita" });
    }
    if (showCobros) {
      const dayCobros = cobros.filter((c) => c.dueDate === dateStr);
      if (dayCobros.length > 0) {
        const anyOverdue = dayCobros.some((c) => c.isOverdue);
        groups.push({ key: "cobro", colorClass: anyOverdue ? GROUP_COLORS.cobroVencido : GROUP_COLORS.cobro, icon: Wallet, title: "Cobro" });
      }
    }
    if (showCumpleanos) {
      const day = Number(dateStr.split("-")[2]);
      if (cumpleanos.some((b) => b.day === day)) {
        groups.push({ key: "cumpleanos", colorClass: GROUP_COLORS.cumpleanos, icon: Cake, title: "Cumpleaños" });
      }
    }
    if (showDiasDePedido && diasDePedido.some((d) => d.date === dateStr)) {
      groups.push({ key: "dia_pedido", colorClass: GROUP_COLORS.diaPedido, icon: Package, title: "Día de pedido" });
    }
    return groups;
  };

  const selectedCobros = showCobros ? cobros.filter((c) => c.dueDate === selectedDate) : [];
  const selectedCumpleanos = showCumpleanos ? cumpleanos.filter((b) => b.day === Number(selectedDate.split("-")[2])) : [];
  const selectedOrderDay = showDiasDePedido ? diasDePedido.find((d) => d.date === selectedDate) : undefined;
  const selectedAppointments = appointmentsToShow.filter((a) => a.date === selectedDate);
  const selectedTotalCount = selectedCobros.length + selectedCumpleanos.length + (selectedOrderDay ? 1 : 0) + selectedAppointments.length;

  const handleSaveAppointment = (input: AppointmentSavePayload) => {
    // Etapa 7.5 — prevención visual, sobre lo que ya está cargado (el mes en vista): backend
    // sigue siendo la autoridad real (índice único de Postgres), esto solo evita el viaje al
    // servidor en el caso obvio.
    const hasConflict = appointments.some(
      (a) => a.date === input.date && a.time === input.time && a.status !== "cancelada" && a.id !== editingAppointment?.id,
    );
    if (hasConflict) {
      toast({ title: "Ya existe un turno en ese horario", variant: "destructive" });
      return;
    }
    if (editingAppointment) {
      updateMutation.mutate({ id: editingAppointment.id, input });
    } else {
      createMutation.mutate(input);
    }
  };

  const openAppointmentDetail = (appointment: AppointmentWithPhone) => {
    setSelectedAppointmentId(appointment.id);
    setDetailOpen(true);
  };

  const handleEditAppointment = (appointment: AppointmentWithPhone) => {
    setEditingAppointment(appointment);
    setDialogOpen(true);
    setDetailOpen(false);
  };

  const handleNewAppointmentClick = () => {
    setEditingAppointment(null);
    setDialogOpen(true);
  };

  const isToday = (day: number) => {
    const today = new Date();
    return day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  };

  const activeFilterLabel = typeFilter === null ? "Todos los eventos" : filterOptions.find((o) => o.value === typeFilter)?.label ?? typeFilter;

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="page-agenda">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Agenda</h1>
          {/* Prompt 12, punto 7 — cuenta SOLO las citas cargadas a mano, nunca cobros/
              cumpleaños/días de pedido (sin importar el filtro elegido). */}
          <p className="text-muted-foreground">
            {appointments.length} cita{appointments.length !== 1 ? "s" : ""} este mes
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2 max-w-full" data-testid="button-filter-events">
                <ListFilter className="h-4 w-4 shrink-0" />
                <span className="truncate">{activeFilterLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-h-[60vh] overflow-y-auto">
              <DropdownMenuItem onClick={() => setTypeFilter(null)} data-testid="option-filter-all">
                <Check className={`h-4 w-4 mr-2 shrink-0 ${typeFilter === null ? "opacity-100" : "opacity-0"}`} />
                Todos los eventos
              </DropdownMenuItem>
              {filterOptions.map((option) => {
                const isAuto = (AUTO_FILTER_VALUES as readonly string[]).includes(option.value);
                const OptionIcon = isAuto
                  ? option.value === "__cobros__"
                    ? Wallet
                    : option.value === "__cumpleanos__"
                      ? Cake
                      : Package
                  : getEventTypeIcon(option.value);
                return (
                  <DropdownMenuItem key={option.value} onClick={() => setTypeFilter(option.value)} data-testid={`option-filter-${option.value}`}>
                    <Check className={`h-4 w-4 mr-2 shrink-0 ${typeFilter === option.value ? "opacity-100" : "opacity-0"}`} />
                    <OptionIcon className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    <span className="truncate">{option.label}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={handleNewAppointmentClick} data-testid="button-add-appointment">
            <Plus className="h-4 w-4 mr-2" />
            Nueva cita
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2" data-testid="card-calendar">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
            <CardTitle className="text-lg">
              {months[month]} {year}
            </CardTitle>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={prevMonth} title="Mes anterior" aria-label="Mes anterior" data-testid="button-prev-month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={nextMonth} title="Mes siguiente" aria-label="Mes siguiente" data-testid="button-next-month">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0 space-y-4">
            {isError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" data-testid="agenda-error">
                Error al cargar la agenda: {(error as Error).message}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-7 gap-1">
                  {daysOfWeek.map((day) => (
                    <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
                      {day}
                    </div>
                  ))}
                  {isLoading
                    ? calendarDays.map((day, index) => (
                        <Skeleton key={day === null ? `empty-${index}` : `loading-${day}`} className="min-h-[60px] rounded-md" />
                      ))
                    : calendarDays.map((day, index) => {
                        if (day === null) {
                          return <div key={`empty-${index}`} className="p-1 sm:p-2" />;
                        }
                        const dateStr = formatDateString(day);
                        const dayGroups = groupsForDay(dateStr);
                        const isSelected = dateStr === selectedDate;
                        const today = isToday(day);

                        return (
                          <button
                            key={day}
                            onClick={() => setSelectedDate(dateStr)}
                            className={`p-1 sm:p-2 rounded-md text-sm hover-elevate active-elevate-2 relative min-h-[60px] flex flex-col items-center ${
                              isSelected ? "bg-primary text-primary-foreground" : ""
                            } ${today && !isSelected ? "ring-2 ring-primary" : ""}`}
                            data-testid={`button-day-${day}`}
                          >
                            <span className={`font-medium ${isSelected ? "" : today ? "text-primary" : ""}`}>{day}</span>
                            {dayGroups.length > 0 && (
                              <div className="flex gap-0.5 mt-1 flex-wrap justify-center">
                                {dayGroups.map((g) => (
                                  <GroupDot key={g.key} colorClass={g.colorClass} icon={g.icon} title={g.title} />
                                ))}
                              </div>
                            )}
                          </button>
                        );
                      })}
                </div>

                {/* Prompt 12, punto 4 — referencia de colores: exactamente estas 4 entradas, cada una con su ícono. */}
                <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-xs text-muted-foreground" data-testid="legend-event-groups">
                  <div className="flex items-center gap-1.5">
                    <GroupDot colorClass={GROUP_COLORS.cita} icon={CalendarDays} title="Citas" big />
                    <span>Citas</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <GroupDot colorClass={GROUP_COLORS.cobro} icon={Wallet} title="Cobros" big />
                    <span>Cobros</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <GroupDot colorClass={GROUP_COLORS.cumpleanos} icon={Cake} title="Cumpleaños" big />
                    <span>Cumpleaños</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <GroupDot colorClass={GROUP_COLORS.diaPedido} icon={Package} title="Días de pedido" big />
                    <span>Días de pedido</span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-day-appointments">
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between gap-2">
              <span>
                {parseLocalDate(selectedDate).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full rounded-md" />
                <Skeleton className="h-20 w-full rounded-md" />
              </div>
            ) : selectedTotalCount > 0 ? (
              <>
                {selectedOrderDay && selectedOrderDay.kind !== "marker" && (
                  <OrderReminderCard
                    title={
                      selectedOrderDay.kind === "real"
                        ? selectedOrderDay.date === getArgentinaDateStr()
                          ? "Hoy es tu día de pedido"
                          : `Tu día de pedido fue el ${formatDateDisplay(selectedOrderDay.date)}`
                        : `El ${formatDateDisplay(selectedOrderDay.date)} es tu día de pedido`
                    }
                    subtitle={
                      selectedOrderDay.kind === "preview"
                        ? "Según lo que vendiste hasta hoy — se va a actualizar hasta que llegue el día"
                        : undefined
                    }
                    items={selectedOrderDay.items ?? []}
                    onBuildOrder={() => openOrderForReminder(selectedOrderDay.items ?? [])}
                    onDismiss={
                      selectedOrderDay.kind === "real" ? () => dismissReminderMutation.mutate(selectedOrderDay.reminderId!) : undefined
                    }
                    isDismissing={dismissReminderMutation.isPending}
                    testId="card-order-reminder-agenda"
                  />
                )}
                {selectedOrderDay && selectedOrderDay.kind === "marker" && (
                  <Card data-testid="card-order-day-marker">
                    <CardContent className="py-3 flex items-center gap-2">
                      <GroupDot colorClass={GROUP_COLORS.diaPedido} icon={Package} title="Día de pedido" big />
                      <span className="text-sm font-medium">Día de pedido</span>
                    </CardContent>
                  </Card>
                )}
                {selectedCumpleanos.map((b) => (
                  <Card key={b.clientId} data-testid={`card-cumpleanos-${b.clientId}`}>
                    <CardContent className="py-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <GroupDot colorClass={GROUP_COLORS.cumpleanos} icon={Cake} title="Cumpleaños" big />
                        <span className="font-medium truncate">Hoy cumple {b.name ?? b.phone ?? "Sin nombre"} 🎂</span>
                      </div>
                      <WhatsAppButton phone={b.phone} variant="icon" />
                    </CardContent>
                  </Card>
                ))}
                {selectedCobros.map((c) => (
                  <Card key={c.installmentId} data-testid={`card-cobro-${c.installmentId}`}>
                    <CardContent className="py-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <GroupDot colorClass={c.isOverdue ? GROUP_COLORS.cobroVencido : GROUP_COLORS.cobro} icon={Wallet} title="Cobro" big />
                        <div className="min-w-0">
                          <p className="font-medium truncate">
                            {c.clientName} te debe {format(c.amount)}
                          </p>
                          <p className="text-sm text-muted-foreground">{c.isOverdue ? "Venció" : "Vence hoy"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmPayInstallment(c)}
                          data-testid={`button-pay-cobro-${c.installmentId}`}
                        >
                          Cobrada
                        </Button>
                        <WhatsAppButton phone={c.clientPhone} variant="icon" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {selectedAppointments.map((apt) => (
                  <AppointmentCard key={apt.id} appointment={apt} onClick={() => openAppointmentDetail(apt)} />
                ))}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center" data-testid="empty-day-appointments">
                <CalendarX className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No hay nada para este día</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AppointmentDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setEditingAppointment(null);
        }}
        onSave={handleSaveAppointment}
        defaultDate={selectedDate}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        existingAppointment={editingAppointment}
      />
      <AppointmentDetailDialog
        open={detailOpen}
        onOpenChange={(next) => {
          setDetailOpen(next);
          if (!next) setSelectedAppointmentId(null);
        }}
        appointment={detailAppointment}
        onEdit={handleEditAppointment}
      />
      <PayInstallmentConfirmDialog installment={confirmPayInstallment} onOpenChange={(open) => !open && setConfirmPayInstallment(null)} />
    </div>
  );
}
