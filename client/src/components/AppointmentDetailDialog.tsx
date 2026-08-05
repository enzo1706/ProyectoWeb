import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Clock, MapPin, FileText } from "lucide-react";
import type { Appointment } from "@shared/schema";
import { typeColors, typeLabels } from "./AppointmentCard";

interface AppointmentDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment | null;
}

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
  completada: "Completada",
};

const statusColors: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  confirmada: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  cancelada: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  completada: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const fallbackTypeColor = "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function AppointmentDetailDialog({ open, onOpenChange, appointment }: AppointmentDetailDialogProps) {
  if (!appointment) return null;

  const type = appointment.type as keyof typeof typeLabels;
  const typeLabel = typeLabels[type] ?? appointment.type;
  const typeColor = typeColors[type] ?? fallbackTypeColor;
  const statusLabel = statusLabels[appointment.status] ?? appointment.status;
  const statusColor = statusColors[appointment.status] ?? fallbackTypeColor;

  const fullDate = parseLocalDate(appointment.date).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-appointment-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="capitalize">{fullDate}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 px-1 -mx-1">
          <div className="flex items-center gap-3 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>{appointment.time}</span>
            <Badge className={typeColor}>{typeLabel}</Badge>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>{appointment.clientName}</span>
          </div>

          {appointment.location && (
            <div className="flex items-center gap-3 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{appointment.location}</span>
            </div>
          )}

          {appointment.notes && (
            <div className="flex items-start gap-3 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-muted-foreground">{appointment.notes}</span>
            </div>
          )}

          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Estado:</span>
            <Badge className={statusColor}>{statusLabel}</Badge>
          </div>
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-appointment-detail">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
