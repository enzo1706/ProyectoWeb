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
import { PHONE_REGEX, PHONE_ERROR_MESSAGE } from "@shared/schema";
import type { Client } from "./ClientCard";

const clientSchema = z.object({
  name: z.string().optional(),
  phone: z.string().regex(PHONE_REGEX, PHONE_ERROR_MESSAGE),
  email: z.string().email("Email inválido").or(z.literal("")).optional(),
  birthday: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

type ClientFormData = z.infer<typeof clientSchema>;

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
  const form = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      birthday: "",
      address: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (client) {
      form.reset({
        name: client.name || "",
        phone: client.phone,
        email: client.email || "",
        birthday: client.birthday || "",
        address: client.address || "",
        notes: client.notes || "",
      });
    } else {
      form.reset({
        name: "",
        phone: "",
        email: "",
        birthday: "",
        address: "",
        notes: "",
      });
    }
  }, [client, form]);

  const onSubmit = (data: ClientFormData) => {
    const email = data.email?.trim() || null;
    const duplicate = existingClients.find((c) => {
      if (client && c.id === client.id) return false;
      if (c.phone === data.phone) return true;
      if (email && c.email && c.email.toLowerCase() === email.toLowerCase()) return true;
      return false;
    });
    if (duplicate) {
      if (duplicate.phone === data.phone) {
        form.setError("phone", { message: "Ya existe una clienta con ese teléfono" });
      } else {
        form.setError("email", { message: "Ya existe una clienta con ese email" });
      }
      return;
    }

    onSave({
      name: data.name || null,
      phone: data.phone,
      email,
      birthday: data.birthday || null,
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
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 px-1 -mx-1">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre Completo (opcional)</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-client-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Teléfono *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          placeholder="2616570560"
                          onChange={(e) => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
                          data-testid="input-client-phone"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="birthday"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cumpleaños (opcional)</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-client-birthday" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
