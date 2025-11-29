import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, User, MapPin } from "lucide-react";

export interface Appointment {
  id: string;
  clientName: string;
  clientId: string;
  date: string;
  time: string;
  type: "seguimiento" | "venta" | "demostracion" | "entrega";
  notes?: string;
  location?: string;
}

interface AppointmentCardProps {
  appointment: Appointment;
  onClick?: (appointment: Appointment) => void;
}

const typeColors: Record<Appointment["type"], string> = {
  seguimiento: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  venta: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  demostracion: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  entrega: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const typeLabels: Record<Appointment["type"], string> = {
  seguimiento: "Seguimiento",
  venta: "Venta",
  demostracion: "Demostración",
  entrega: "Entrega",
};

export function AppointmentCard({ appointment, onClick }: AppointmentCardProps) {
  return (
    <Card
      className="hover-elevate cursor-pointer"
      onClick={() => onClick?.(appointment)}
      data-testid={`card-appointment-${appointment.id}`}
    >
      <CardContent className="py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium truncate">{appointment.clientName}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{appointment.time}</span>
            </div>
            {appointment.location && (
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{appointment.location}</span>
              </div>
            )}
          </div>
          <Badge className={typeColors[appointment.type]}>
            {typeLabels[appointment.type]}
          </Badge>
        </div>
        {appointment.notes && (
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
            {appointment.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
