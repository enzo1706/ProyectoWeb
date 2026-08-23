import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
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
import { X } from "lucide-react";
import { appointmentTypeSchema, createAppointmentSchema, type Appointment } from "@shared/schema";
import { FIXED_EVENT_TYPES } from "@shared/eventTypes";
import { getEventTypeLabel } from "./AppointmentCard";
import { apiRequest } from "@/lib/queryClient";
import { ClientCombobox } from "./ClientCombobox";
import type { Client } from "./ClientCard";

/** Sentinel que representa la opción "Crear evento" en el select — nunca se manda al backend,
 * apenas se elige el diálogo pasa a modo "nombre nuevo" (ver customMode más abajo). */
const CUSTOM_TYPE_SENTINEL = "__crear_evento__";

const appointmentFormSchema = z.object({
  date: z.string().min(1, "La fecha es requerida"),
  time: z.string().min(1, "La hora es requerida"),
  type: appointmentTypeSchema,
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
  const [customMode, setCustomMode] = useState(false);
  const isEditMode = !!existingAppointment;
  const defaultType = FIXED_EVENT_TYPES[0].value;

  const form = useForm<AppointmentFormData>({
    resolver: zodResolver(appointmentFormSchema),
    defaultValues: {
      date: defaultDate || "",
      time: "",
      type: defaultType,
      location: "",
      notes: "",
    },
  });

  // Tipos personalizados que la consultora ya creó antes, para ofrecerlos de nuevo en vez de
  // que tenga que reescribir el nombre cada vez (y así el backend los reconoce como el mismo tipo).
  const { data: customTypes = [] } = useQuery<string[]>({
    queryKey: ["/api/appointments/custom-types"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/appointments/custom-types");
      return res.json();
    },
    enabled: open,
  });

  // El tipo actual de la cita (fijo, legacy, o personalizado) siempre tiene que estar en la
  // lista de opciones del select, aunque no esté entre los fijos ni en customTypes todavía.
  const typeOptions = useMemo(() => {
    const options = FIXED_EVENT_TYPES.map((t) => ({ value: t.value, label: t.label }));
    const known = new Set(options.map((o) => o.value));
    for (const custom of customTypes) {
      if (!known.has(custom)) {
        options.push({ value: custom, label: custom });
        known.add(custom);
      }
    }
    if (existingAppointment && !known.has(existingAppointment.type)) {
      options.push({ value: existingAppointment.type, label: getEventTypeLabel(existingAppointment.type) });
    }
    return options;
  }, [customTypes, existingAppointment]);

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
        type: existingAppointment.type,
        location: existingAppointment.location ?? "",
        notes: existingAppointment.notes ?? "",
      });
      setSelectedClient(appointmentClientStub(existingAppointment));
      setCustomMode(false);
    }
  }, [open, existingAppointment, form]);

  // Resetear solo al cerrar (cancelar o éxito confirmado), nunca al enviar —
  // si el guardado falla el diálogo queda abierto y los datos cargados se conservan.
  useEffect(() => {
    if (!open) {
      form.reset({
        date: defaultDate || "",
        time: "",
        type: defaultType,
        location: "",
        notes: "",
      });
      setSelectedClient(null);
      setCustomMode(false);
    }
  }, [open, defaultDate, defaultType, form]);

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
                    {customMode ? (
                      <div className="flex items-center gap-1.5">
                        <FormControl>
                          <Input
                            autoFocus
                            placeholder="Nombre del evento"
                            value={field.value}
                            onChange={field.onChange}
                            maxLength={40}
                            data-testid="input-appointment-custom-type"
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          title="Volver a la lista de tipos"
                          aria-label="Volver a la lista de tipos"
                          onClick={() => {
                            setCustomMode(false);
                            field.onChange(defaultType);
                          }}
                          data-testid="button-cancel-custom-type"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <Select
                        onValueChange={(value) => {
                          if (value === CUSTOM_TYPE_SENTINEL) {
                            setCustomMode(true);
                            field.onChange("");
                          } else {
                            field.onChange(value);
                          }
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-appointment-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {typeOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value} data-testid={`option-type-${option.value}`}>
                              {option.label}
                            </SelectItem>
                          ))}
                          <SelectItem value={CUSTOM_TYPE_SENTINEL} data-testid="option-type-custom">
                            Crear evento
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    )}
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
