import { useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Appointment } from "./AppointmentCard";

const appointmentSchema = z.object({
  clientId: z.string().min(1, "Selecciona una clienta"),
  date: z.string().min(1, "La fecha es requerida"),
  time: z.string().min(1, "La hora es requerida"),
  type: z.enum(["seguimiento", "venta", "demostracion", "entrega"]),
  location: z.string().optional(),
  notes: z.string().optional(),
});

type AppointmentFormData = z.infer<typeof appointmentSchema>;

interface AppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (appointment: Omit<Appointment, "id">) => void;
  defaultDate?: string;
}

// todo: remove mock functionality
const mockClients = [
  { id: "c1", name: "María García López" },
  { id: "c2", name: "Ana Martínez Ruiz" },
  { id: "c3", name: "Laura Hernández" },
  { id: "c4", name: "Patricia Ruiz Sánchez" },
  { id: "c5", name: "Carmen Flores" },
  { id: "c7", name: "Guadalupe Torres" },
];

export function AppointmentDialog({ open, onOpenChange, onSave, defaultDate }: AppointmentDialogProps) {
  const form = useForm<AppointmentFormData>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: {
      clientId: "",
      date: defaultDate || "",
      time: "",
      type: "seguimiento",
      location: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (defaultDate) {
      form.setValue("date", defaultDate);
    }
  }, [defaultDate, form]);

  const onSubmit = (data: AppointmentFormData) => {
    const client = mockClients.find(c => c.id === data.clientId);
    if (!client) return;

    onSave({
      clientId: data.clientId,
      clientName: client.name,
      date: data.date,
      time: data.time,
      type: data.type,
      location: data.location,
      notes: data.notes,
    });
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-appointment">
        <DialogHeader>
          <DialogTitle>Nueva Cita</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Clienta</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-appointment-client">
                        <SelectValue placeholder="Seleccionar clienta" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {mockClients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
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
                      <SelectItem value="seguimiento">Seguimiento</SelectItem>
                      <SelectItem value="venta">Venta</SelectItem>
                      <SelectItem value="demostracion">Demostración</SelectItem>
                      <SelectItem value="entrega">Entrega</SelectItem>
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
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" data-testid="button-save-appointment">
                Crear Cita
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
