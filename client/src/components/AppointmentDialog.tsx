import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { appointmentTypes, createAppointmentSchema, type Appointment } from "@shared/schema";
import { typeLabels } from "./AppointmentCard";
import { ClientCombobox } from "./ClientCombobox";
import type { Client } from "./ClientCard";

const appointmentFormSchema = z.object({
  date: z.string().min(1, "La fecha es requerida"),
  time: z.string().min(1, "La hora es requerida"),
  type: z.enum(appointmentTypes),
  location: z.string().optional(),
  notes: z.string().optional(),
});

type AppointmentFormData = z.infer<typeof appointmentFormSchema>;
// Misma forma que createAppointmentSchema (clientId/date/time/type/location/notes) — el padre
// (Agenda.tsx) decide si esto se manda por POST (crear) o PATCH (editar), este diálogo no lo sabe.
type AppointmentSavePayload = z.infer<typeof createAppointmentSchema>;

interface AppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (appointment: AppointmentSavePayload) => void;
  defaultDate?: string;
  isSubmitting?: boolean;
  /** Si viene seteada, el diálogo entra en modo edición sobre esta cita en vez de crear una nueva. */
  existingAppointment?: Appointment | null;
}

/**
 * La cita solo guarda clientId + clientName, no el objeto Client completo. Para poder mostrar
 * (y dejar cambiar) la clienta en modo edición sin pedirle un endpoint nuevo al backend, se arma
 * un Client "stub" con los dos datos que ya tenemos — ClientCombobox solo usa name/phone para
 * mostrar el valor actual, así que alcanza para prefill; si la consultora busca otra clienta, ahí
 * sí se reemplaza por un Client real.
 */
function appointmentClientStub(appointment: Appointment): Client {
  return {
    id: appointment.clientId ?? 0,
    consultantId: appointment.consultantId,
    name: appointment.clientName,
    phone: "",
    email: null,
    birthday: null,
    address: null,
    notes: null,
    totalPurchases: 0,
    lastPurchase: null,
  };
}

export function AppointmentDialog({
  open,
  onOpenChange,
  onSave,
  defaultDate,
  isSubmitting = false,
  existingAppointment,
}: AppointmentDialogProps) {
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const isEditMode = !!existingAppointment;

  const form = useForm<AppointmentFormData>({
    resolver: zodResolver(appointmentFormSchema),
    defaultValues: {
      date: defaultDate || "",
      time: "",
      type: "seguimiento",
      location: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (defaultDate && !existingAppointment) {
      form.setValue("date", defaultDate);
    }
  }, [defaultDate, existingAppointment, form]);

  useEffect(() => {
    if (open && existingAppointment) {
      form.reset({
        date: existingAppointment.date,
        time: existingAppointment.time,
        type: existingAppointment.type as (typeof appointmentTypes)[number],
        location: existingAppointment.location ?? "",
        notes: existingAppointment.notes ?? "",
      });
      setSelectedClient(appointmentClientStub(existingAppointment));
    }
  }, [open, existingAppointment, form]);

  // Resetear solo al cerrar (cancelar o éxito confirmado), nunca al enviar —
  // si el guardado falla el diálogo queda abierto y los datos cargados se conservan.
  useEffect(() => {
    if (!open) {
      form.reset({
        date: defaultDate || "",
        time: "",
        type: "seguimiento",
        location: "",
        notes: "",
      });
      setSelectedClient(null);
    }
  }, [open, defaultDate, form]);

  const onSubmit = (data: AppointmentFormData) => {
    if (!selectedClient) return;

    onSave({
      clientId: selectedClient.id,
      date: data.date,
      time: data.time,
      type: data.type,
      location: data.location,
      notes: data.notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-appointment">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Editar Cita" : "Nueva Cita"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 px-1 -mx-1">
              <div className="space-y-1.5">
                <Label htmlFor="appointment-client">Clienta</Label>
                <ClientCombobox id="appointment-client" value={selectedClient} onSelect={setSelectedClient} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-appointment-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hora</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} data-testid="input-appointment-time" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Cita</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-appointment-type">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {appointmentTypes.map((type) => (
                          <SelectItem key={type} value={type}>{typeLabels[type]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ubicación (opcional)</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Dirección o lugar" data-testid="input-appointment-location" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas (opcional)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        placeholder="Detalles adicionales"
                        data-testid="input-appointment-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex justify-end gap-2 pt-4 shrink-0 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!selectedClient || isSubmitting} data-testid="button-save-appointment">
                {isSubmitting ? "Guardando..." : isEditMode ? "Guardar Cambios" : "Crear Cita"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
