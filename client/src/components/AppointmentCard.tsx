import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  User,
  MapPin,
  Sparkles,
  GraduationCap,
  Package,
  Footprints,
  Presentation,
  PhoneCall,
  ShoppingBag,
  Tag,
  type LucideIcon,
} from "lucide-react";
import type { Appointment } from "@shared/schema";
import { getEventTypeLabel, getEventTypeColorClass } from "@shared/eventTypes";
import { onActivationKeyDown } from "@/lib/utils";

interface AppointmentCardProps {
  appointment: Appointment;
  onClick?: (appointment: Appointment) => void;
}

// Reexportadas desde acá por compatibilidad con el resto de la app (Dashboard, diálogos de
// cita): la fuente de verdad de labels/colores es shared/eventTypes.ts (la comparten frontend
// y backend); acá solo se agrega el ícono, que es React y no puede vivir en shared/.
export { getEventTypeLabel, getEventTypeColorClass };

/** Correspondencia fija tipo -> ícono. Los tipos personalizados (no están acá) usan Tag. */
const TYPE_ICONS: Record<string, LucideIcon> = {
  sesion_belleza: Sparkles,
  capacitacion: GraduationCap,
  entrega: Package,
  visita: Footprints,
  demostracion: Presentation,
  seguimiento: PhoneCall,
  venta: ShoppingBag,
};

export function getEventTypeIcon(type: string): LucideIcon {
  return TYPE_ICONS[type] ?? Tag;
}

export function AppointmentCard({ appointment, onClick }: AppointmentCardProps) {
  const typeColor = getEventTypeColorClass(appointment.type);
  const typeLabel = getEventTypeLabel(appointment.type);
  const TypeIcon = getEventTypeIcon(appointment.type);

  return (
    <Card
      className="hover-elevate cursor-pointer"
      onClick={() => onClick?.(appointment)}
      role="button"
      tabIndex={0}
      onKeyDown={onActivationKeyDown(() => onClick?.(appointment))}
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
          <Badge className={`${typeColor} gap-1`}>
            <TypeIcon className="h-3 w-3" />
            {typeLabel}
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
