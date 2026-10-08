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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Contact } from "lucide-react";
import { normalizeArgentinaPhoneForStorage } from "@shared/phone";
import { useToast } from "@/hooks/use-toast";
import type { Client } from "./ClientCard";

// Prompt 9, punto 3 — año sentinela invisible para un cumpleaños nuevo/editado desde este
// formulario (que ya no pide año). 2000 es bisiesto a propósito: un 29 de febrero tiene que
// poder guardarse igual que cualquier otro día. Las clientas que ya tenían un cumpleaños con
// año real lo conservan tal cual mientras no se vuelva a guardar desde este formulario (ver
// birthdayToDayMonth/dayMonthToBirthday, que reusan el año existente si hay uno).
const BIRTHDAY_SENTINEL_YEAR = "2000";

const MONTHS = [
  { value: "01", label: "Enero" },
  { value: "02", label: "Febrero" },
  { value: "03", label: "Marzo" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Mayo" },
  { value: "06", label: "Junio" },
  { value: "07", label: "Julio" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Septiembre" },
  { value: "10", label: "Octubre" },
  { value: "11", label: "Noviembre" },
  { value: "12", label: "Diciembre" },
] as const;

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));

function birthdayToDayMonth(birthday: string | null | undefined): { day: string; month: string } {
  if (!birthday) return { day: "", month: "" };
  const [, month, day] = birthday.split("-");
  return { day: day ?? "", month: month ?? "" };
}

/** Conserva el año real si la clienta ya tenía uno guardado — nunca lo pisa con el sentinela
 * "de paso", solo cuando de verdad no había ninguno (clienta nueva, o nunca tuvo cumpleaños
 * cargado). */
function dayMonthToBirthday(day: string, month: string, existing: string | null | undefined): string | null {
  if (!day || !month) return null;
  const year = existing?.split("-")[0] || BIRTHDAY_SENTINEL_YEAR;
  return `${year}-${month}-${day}`;
}

// Prompt 9, punto 1 — el teléfono acepta cualquier forma razonable de escribirlo (espacios,
// guiones, +54) y se normaliza con la MISMA función que usa el backend (shared/phone.ts) antes
// de guardar — nunca una validación de formato aparte del lado del cliente.
const clientSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio"),
  phone: z
    .string()
    .optional()
    .refine((val) => !val || !val.trim() || normalizeArgentinaPhoneForStorage(val) !== null, {
      message: "Revisá el celular — tiene que tener código de área y número (ej: 261 555 1234)",
    }),
  email: z.string().email("Email inválido").or(z.literal("")).optional(),
  birthdayDay: z.string().optional(),
  birthdayMonth: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

type ClientFormData = z.infer<typeof clientSchema>;

/** Prompt 9, punto 2 — "Importar desde mis contactos" solo se muestra donde la Contact Picker
 * API de verdad funciona (hoy, Chrome en Android) — se detecta soporte real, nunca se adivina
 * por user-agent/tipo de dispositivo. */
function supportsContactPicker(): boolean {
  return typeof navigator !== "undefined" && "contacts" in navigator && "ContactsManager" in window;
}

interface ClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client | null;
  // consultantId nunca se manda desde el cliente — el backend lo deriva de la sesión.
  onSave: (client: Omit<Client, "id" | "totalPurchases" | "lastPurchase" | "consultantId">) => void;
  /** Clientas ya cargadas en la lista actual — se usa para un chequeo rápido de duplicados
   * en el cliente. El backend sigue siendo la fuente de verdad (valida contra toda la base). */
  existingClients?: Client[];
  /** La mutation de guardado vive en el padre (Clientas.tsx) — este flag es lo único que
   * el diálogo necesita para mostrar el estado de "guardando". */
  isSaving?: boolean;
}

export function ClientDialog({
  open,
  onOpenChange,
  client,
  onSave,
  existingClients = [],
  isSaving = false,
}: ClientDialogProps) {
  const { toast } = useToast();
  const [canImportContact] = useState(supportsContactPicker);

  const form = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      birthdayDay: "",
      birthdayMonth: "",
      address: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (client) {
      const { day, month } = birthdayToDayMonth(client.birthday);
      form.reset({
        name: client.name || "",
        phone: client.phone ?? "",
        email: client.email || "",
        birthdayDay: day,
        birthdayMonth: month,
        address: client.address || "",
        notes: client.notes || "",
      });
    } else {
      form.reset({
        name: "",
        phone: "",
        email: "",
        birthdayDay: "",
        birthdayMonth: "",
        address: "",
        notes: "",
      });
    }
  }, [client, form]);

  const handleImportContact = async () => {
    try {
      // @ts-expect-error — Contact Picker API todavía no tiene tipos oficiales en TS/lib.dom.
      const [contact] = await navigator.contacts.select(["name", "tel"], { multiple: false });
      if (!contact) return;
      const name = Array.isArray(contact.name) ? contact.name[0] : contact.name;
      const rawPhone = Array.isArray(contact.tel) ? contact.tel[0] : contact.tel;
      if (name) form.setValue("name", name);
      if (rawPhone) {
        const normalized = normalizeArgentinaPhoneForStorage(rawPhone);
        if (normalized) {
          form.setValue("phone", normalized);
        } else {
          toast({ title: "No pudimos leer el celular de ese contacto", description: "Revisalo a mano.", variant: "destructive" });
        }
      }
    } catch {
      // El usuario canceló el picker, o el navegador lo rechazó — no es un error que avisar.
    }
  };

  const onSubmit = (data: ClientFormData) => {
    const email = data.email?.trim() || null;
    const phone = data.phone?.trim() ? normalizeArgentinaPhoneForStorage(data.phone) : null;
    const duplicate = existingClients.find((c) => {
      if (client && c.id === client.id) return false;
      if (phone && c.phone === phone) return true;
      if (email && c.email && c.email.toLowerCase() === email.toLowerCase()) return true;
      return false;
    });
    if (duplicate) {
      if (phone && duplicate.phone === phone) {
        form.setError("phone", { message: "Ya existe una clienta con ese celular" });
      } else {
        form.setError("email", { message: "Ya existe una clienta con ese email" });
      }
      return;
    }

    onSave({
      name: data.name.trim(),
      phone,
      email,
      birthday: dayMonthToBirthday(data.birthdayDay ?? "", data.birthdayMonth ?? "", client?.birthday),
      address: data.address || null,
      notes: data.notes || null,
    });
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-client">
        <DialogHeader>
          <DialogTitle>{client ? "Editar Clienta" : "Nueva Clienta"}</DialogTitle>
        </DialogHeader>
        {!client && canImportContact && (
          <Button
            type="button"
            variant="outline"
            className="w-full border-dashed"
            onClick={handleImportContact}
            data-testid="button-import-contact"
          >
            <Contact className="mr-2 h-4 w-4" />
            Importar desde mis contactos
          </Button>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 px-1 -mx-1">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre y apellido</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-client-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Celular (opcional)</FormLabel>
                    <FormControl>
                      <Input {...field} type="tel" inputMode="numeric" placeholder="Ej.: 261 555 1234" data-testid="input-client-phone" />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Lo usamos para el botón de WhatsApp.</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-1.5">
                <FormLabel>Cumpleaños (opcional)</FormLabel>
                <div className="grid grid-cols-2 gap-2">
                  <FormField
                    control={form.control}
                    name="birthdayDay"
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <SelectTrigger data-testid="select-client-birthday-day">
                          <SelectValue placeholder="Día" />
                        </SelectTrigger>
                        <SelectContent>
                          {DAYS.map((d) => (
                            <SelectItem key={d} value={d}>{d}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="birthdayMonth"
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <SelectTrigger data-testid="select-client-birthday-month">
                          <SelectValue placeholder="Mes" />
                        </SelectTrigger>
                        <SelectContent>
                          {MONTHS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email (opcional)</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} data-testid="input-client-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dirección (opcional)</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-client-address" />
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
                        rows={3}
                        placeholder="Preferencias, productos favoritos, etc."
                        data-testid="input-client-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex justify-end gap-2 pt-4 shrink-0 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving} data-testid="button-save-client">
                {isSaving ? "Guardando..." : client ? "Guardar Cambios" : "Crear Clienta"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
