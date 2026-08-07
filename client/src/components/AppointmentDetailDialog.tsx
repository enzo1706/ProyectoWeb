import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { User, Clock, MapPin, FileText, Pencil, Trash2 } from "lucide-react";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { appointmentStatuses, type Appointment, type AppointmentStatus } from "@shared/schema";
import { typeColors, typeLabels } from "./AppointmentCard";
import { parseLocalDate } from "@/lib/date";

interface AppointmentDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment | null;
  /** Opcional: si no se pasa (ej. desde el Dashboard, que no tiene diálogo de edición propio),
   * no se muestra el botón "Editar" — cambiar estado y eliminar siguen disponibles igual. */
  onEdit?: (appointment: Appointment) => void;
}

const statusLabels: Record<AppointmentStatus, string> = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  completada: "Completada",
  cancelada: "Cancelada",
};

const statusColors: Record<AppointmentStatus, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  confirmada: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  completada: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  cancelada: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const fallbackTypeColor = "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";

export function AppointmentDetailDialog({ open, onOpenChange, appointment, onEdit }: AppointmentDetailDialogProps) {
  const { toast } = useToast();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const invalidateAfterChange = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/appointments/upcoming"] });
    queryClient.invalidateQueries({ queryKey: ["/api/reports/appointments-summary"] });
    if (appointment?.clientId) {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", appointment.clientId, "appointments"] });
    }
  };

  const statusMutation = useGuardedMutation({
    mutationFn: async (status: AppointmentStatus) => {
      const res = await apiRequest("PATCH", `/api/appointments/${appointment!.id}/status`, { status });
      return res.json() as Promise<Appointment>;
    },
    onSuccess: () => {
      invalidateAfterChange();
      toast({ title: "Estado actualizado" });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo actualizar el estado", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useGuardedMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/appointments/${appointment!.id}`);
    },
    onSuccess: () => {
      invalidateAfterChange();
      toast({ title: "Cita eliminada" });
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo eliminar la cita", description: err.message, variant: "destructive" });
    },
  });

  const type = appointment?.type as keyof typeof typeLabels | undefined;
  const typeLabel = type ? typeLabels[type] ?? appointment?.type : "";
  const typeColor = type ? typeColors[type] ?? fallbackTypeColor : fallbackTypeColor;
  const currentStatus = (appointment?.status as AppointmentStatus) ?? "pendiente";

  const fullDate = appointment
    ? parseLocalDate(appointment.date).toLocaleDateString("es-MX", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  // El Dialog/AlertDialog se mantienen siempre montados y se cierran vía su prop `open`
  // en vez de desmontarse de golpe cuando `appointment` pasa a null (ej. al cancelar una
  // cita desde el Dashboard, donde "Próximas Citas" la filtra apenas cambia el estado) —
  // desmontar el Dialog mientras open=true rompe el ciclo de vida de Radix y deja el
  // botón "Cerrar" inexistente en el DOM en vez de cerrar la ventana prolijamente.
  return (
    <>
      <Dialog open={open && !!appointment} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md" data-testid="dialog-appointment-detail">
          {appointment && (
            <>
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
                  <span className="text-muted-foreground shrink-0">Estado:</span>
                  <Select
                    value={currentStatus}
                    onValueChange={(v) => statusMutation.mutate(v as AppointmentStatus)}
                    disabled={statusMutation.isPending}
                  >
                    <SelectTrigger className="w-[180px]" data-testid="select-appointment-status">
                      <SelectValue>
                        <Badge className={statusColors[currentStatus]}>{statusLabels[currentStatus]}</Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {appointmentStatuses.map((status) => (
                        <SelectItem key={status} value={status} data-testid={`option-status-${status}`}>
                          {statusLabels[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter className="border-t pt-4 flex-wrap gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-appointment-detail">
                  Cerrar
                </Button>
                {onEdit && (
                  <Button variant="outline" onClick={() => onEdit(appointment)} data-testid="button-edit-appointment">
                    <Pencil className="h-4 w-4 mr-2" />
                    Editar
                  </Button>
                )}
                <Button variant="destructive" onClick={() => setDeleteConfirmOpen(true)} data-testid="button-delete-appointment">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Eliminar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen && !!appointment} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-delete-appointment">
          {appointment && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar esta cita?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción no se puede deshacer. La cita con {appointment.clientName} del {fullDate} se va a
                  eliminar por completo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-confirm-delete-appointment-no">No, volver</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: "destructive" })}
                  onClick={(e) => {
                    e.preventDefault();
                    deleteMutation.mutate();
                  }}
                  disabled={deleteMutation.isPending}
                  data-testid="button-confirm-delete-appointment-yes"
                >
                  {deleteMutation.isPending ? "Eliminando..." : "Sí, eliminar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
