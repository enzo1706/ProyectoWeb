import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AppointmentCard } from "@/components/AppointmentCard";
import { AppointmentDialog } from "@/components/AppointmentDialog";
import { AppointmentDetailDialog } from "@/components/AppointmentDetailDialog";
import { Plus, ChevronLeft, ChevronRight, CalendarX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { createAppointmentSchema, type Appointment } from "@shared/schema";
import { toDateStr, parseLocalDate } from "@/lib/date";
import type { z } from "zod";

// Misma forma que usa AppointmentDialog para crear y editar (ver comentario ahí).
type AppointmentSavePayload = z.infer<typeof createAppointmentSchema>;

const daysOfWeek = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default function Agenda() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string>(() => toDateStr(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStart = toDateStr(new Date(year, month, 1));
  const monthEnd = toDateStr(new Date(year, month + 1, 1));

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

  const { data: appointments = [], isLoading, isError, error } = useQuery<Appointment[]>({
    queryKey: ["/api/appointments", monthStart, monthEnd],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/appointments?start=${monthStart}&end=${monthEnd}`);
      return res.json();
    },
  });

  // Se deriva de la lista en vivo (no un snapshot guardado al hacer click) para que el diálogo
  // de detalle siempre muestre el estado más reciente después de editar/cambiar estado.
  const detailAppointment = appointments.find((a) => a.id === selectedAppointmentId) ?? null;

  const createMutation = useGuardedMutation({
    mutationFn: async (input: AppointmentSavePayload) => {
      const res = await apiRequest("POST", "/api/appointments", input);
      return res.json() as Promise<Appointment>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/upcoming"] });
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
      return res.json() as Promise<Appointment>;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/appointments-summary"] });
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

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const formatDateString = (day: number) => toDateStr(new Date(year, month, day));

  const getAppointmentsForDay = (day: number) => {
    const dateStr = formatDateString(day);
    return appointments.filter(a => a.date === dateStr);
  };

  const selectedAppointments = appointments.filter(a => a.date === selectedDate);

  const handleSaveAppointment = (input: AppointmentSavePayload) => {
    if (editingAppointment) {
      updateMutation.mutate({ id: editingAppointment.id, input });
    } else {
      createMutation.mutate(input);
    }
  };

  const openAppointmentDetail = (appointment: Appointment) => {
    setSelectedAppointmentId(appointment.id);
    setDetailOpen(true);
  };

  const handleEditAppointment = (appointment: Appointment) => {
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

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="page-agenda">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Agenda</h1>
          <p className="text-muted-foreground">
            {appointments.length} cita{appointments.length !== 1 ? "s" : ""} este mes
          </p>
        </div>
        <Button onClick={handleNewAppointmentClick} data-testid="button-add-appointment">
          <Plus className="h-4 w-4 mr-2" />
          Nueva Cita
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2" data-testid="card-calendar">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
            <CardTitle className="text-lg">
              {months[month]} {year}
            </CardTitle>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={prevMonth}
                title="Mes anterior"
                aria-label="Mes anterior"
                data-testid="button-prev-month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={nextMonth}
                title="Mes siguiente"
                aria-label="Mes siguiente"
                data-testid="button-next-month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            {isError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" data-testid="agenda-error">
                Error al cargar las citas: {(error as Error).message}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {daysOfWeek.map((day) => (
                  <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
                    {day}
                  </div>
                ))}
                {isLoading
                  ? calendarDays.map((day, index) => (
                      <Skeleton
                        key={day === null ? `empty-${index}` : `loading-${day}`}
                        className="min-h-[60px] rounded-md"
                      />
                    ))
                  : calendarDays.map((day, index) => {
                      if (day === null) {
                        return <div key={`empty-${index}`} className="p-1 sm:p-2" />;
                      }
                      const dateStr = formatDateString(day);
                      const dayAppointments = getAppointmentsForDay(day);
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
                          <span className={`font-medium ${isSelected ? "" : today ? "text-primary" : ""}`}>
                            {day}
                          </span>
                          {dayAppointments.length > 0 && (
                            <div className="flex gap-0.5 mt-1 flex-wrap justify-center">
                              {dayAppointments.slice(0, 3).map((_, i) => (
                                <div
                                  key={i}
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    isSelected ? "bg-primary-foreground" : "bg-primary"
                                  }`}
                                />
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-day-appointments">
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between gap-2">
              <span>
                {parseLocalDate(selectedDate).toLocaleDateString("es-MX", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </span>
              <Badge variant="secondary">{selectedAppointments.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full rounded-md" />
                <Skeleton className="h-20 w-full rounded-md" />
              </div>
            ) : selectedAppointments.length > 0 ? (
              selectedAppointments.map((apt) => (
                <AppointmentCard key={apt.id} appointment={apt} onClick={() => openAppointmentDetail(apt)} />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center" data-testid="empty-day-appointments">
                <CalendarX className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No hay citas para este día</p>
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
    </div>
  );
}
