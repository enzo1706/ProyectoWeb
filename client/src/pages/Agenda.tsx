import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppointmentCard, type Appointment } from "@/components/AppointmentCard";
import { AppointmentDialog } from "@/components/AppointmentDialog";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// todo: remove mock functionality
const initialAppointments: Appointment[] = [
  { id: "1", clientName: "María García", clientId: "c1", date: "2025-11-29", time: "10:00 AM", type: "demostracion", location: "Col. Roma Norte" },
  { id: "2", clientName: "Ana Martínez", clientId: "c2", date: "2025-11-29", time: "3:00 PM", type: "entrega", notes: "Entregar pedido de labiales" },
  { id: "3", clientName: "Laura Hernández", clientId: "c3", date: "2025-11-30", time: "11:00 AM", type: "seguimiento" },
  { id: "4", clientName: "Patricia Ruiz", clientId: "c4", date: "2025-12-01", time: "5:00 PM", type: "venta", location: "Su oficina" },
  { id: "5", clientName: "Carmen Flores", clientId: "c5", date: "2025-12-02", time: "12:00 PM", type: "demostracion" },
  { id: "6", clientName: "Guadalupe Torres", clientId: "c7", date: "2025-12-03", time: "4:00 PM", type: "seguimiento", notes: "Seguimiento productos TimeWise" },
];

const daysOfWeek = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default function Agenda() {
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  const [currentDate, setCurrentDate] = useState(new Date(2025, 10, 29)); // Nov 29, 2025
  const [selectedDate, setSelectedDate] = useState<string>("2025-11-29");
  const [dialogOpen, setDialogOpen] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const formatDateString = (day: number) => {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const getAppointmentsForDay = (day: number) => {
    const dateStr = formatDateString(day);
    return appointments.filter(a => a.date === dateStr);
  };

  const selectedAppointments = appointments.filter(a => a.date === selectedDate);

  const handleNewAppointment = (appointment: Omit<Appointment, "id">) => {
    const newAppointment: Appointment = {
      ...appointment,
      id: `a${Date.now()}`,
    };
    setAppointments([...appointments, newAppointment]);
    setDialogOpen(false);
  };

  const isToday = (day: number) => {
    const today = new Date();
    return day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-agenda">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Agenda</h1>
          <p className="text-muted-foreground">
            {appointments.length} citas programadas
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} data-testid="button-add-appointment">
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
              <Button variant="ghost" size="icon" onClick={prevMonth} data-testid="button-prev-month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={nextMonth} data-testid="button-next-month">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1">
              {daysOfWeek.map((day) => (
                <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
                  {day}
                </div>
              ))}
              {calendarDays.map((day, index) => {
                if (day === null) {
                  return <div key={`empty-${index}`} className="p-2" />;
                }
                const dateStr = formatDateString(day);
                const dayAppointments = getAppointmentsForDay(day);
                const isSelected = dateStr === selectedDate;
                const today = isToday(day);

                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(dateStr)}
                    className={`p-2 rounded-md text-sm hover-elevate relative min-h-[60px] flex flex-col items-center ${
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
          </CardContent>
        </Card>

        <Card data-testid="card-day-appointments">
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between gap-2">
              <span>
                {new Date(selectedDate).toLocaleDateString("es-MX", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </span>
              <Badge variant="secondary">{selectedAppointments.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {selectedAppointments.length > 0 ? (
              selectedAppointments.map((apt) => (
                <AppointmentCard key={apt.id} appointment={apt} />
              ))
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No hay citas para este día
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <AppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleNewAppointment}
        defaultDate={selectedDate}
      />
    </div>
  );
}
