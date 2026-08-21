import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { updateBusinessSettingsSchema, type Consultant } from "@shared/schema";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings } from "lucide-react";

// El form trabaja el objetivo mensual en pesos (como el resto de los inputs de dinero de
// la app); se convierte a centavos recién al mandarlo al backend. Mismo criterio para el
// umbral de stock bajo: string en el form, número (o null) recién al enviarlo.
const formSchema = updateBusinessSettingsSchema.extend({
  monthlyGoal: z.string().optional(),
  defaultLowStockThreshold: z.string().optional(),
});
type FormData = z.infer<typeof formSchema>;

export default function Configuracion() {
  const { toast } = useToast();

  const { data: settings, isLoading, isError, error } = useQuery<Consultant>({
    queryKey: ["/api/business-settings"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { businessName: "", currency: "ARS", monthlyGoal: "", defaultLowStockThreshold: "" },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        businessName: settings.businessName,
        currency: settings.currency,
        monthlyGoal: settings.monthlyGoal !== null ? String(settings.monthlyGoal / 100) : "",
        defaultLowStockThreshold:
          settings.defaultLowStockThreshold !== null ? String(settings.defaultLowStockThreshold) : "",
      });
    }
  }, [settings, form]);

  const saveMutation = useGuardedMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("PATCH", "/api/business-settings", {
        businessName: data.businessName,
        currency: data.currency,
        monthlyGoal: data.monthlyGoal ? Math.round(Number(data.monthlyGoal) * 100) : null,
        defaultLowStockThreshold: data.defaultLowStockThreshold ? Math.round(Number(data.defaultLowStockThreshold)) : null,
      });
      return res.json() as Promise<Consultant>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-settings"] });
      toast({ title: "Configuración guardada" });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo guardar la configuración", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl" data-testid="page-configuracion">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Settings className="h-7 w-7 text-primary" />
          Configuración
        </h1>
        <p className="text-muted-foreground">Datos de tu negocio</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Negocio</CardTitle>
          <CardDescription>Esta información se usa en toda la aplicación.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" data-testid="configuracion-error">
              Error al cargar la configuración: {(error as Error).message}
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="businessName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre del negocio</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-business-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Moneda</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          maxLength={3}
                          className="uppercase w-24"
                          placeholder="ARS"
                          data-testid="input-currency"
                        />
                      </FormControl>
                      <FormDescription>Código ISO de 3 letras (ej. ARS, USD).</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="monthlyGoal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Objetivo mensual de ventas</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={0}
                          step="1"
                          placeholder="Sin definir"
                          data-testid="input-monthly-goal"
                        />
                      </FormControl>
                      <FormDescription>Opcional — queda guardado como parte de la configuración del negocio.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="defaultLowStockThreshold"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Umbral de stock bajo predeterminado</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={1}
                          step="1"
                          placeholder="2"
                          data-testid="input-default-low-stock-threshold"
                        />
                      </FormControl>
                      <FormDescription>
                        Se te va a avisar cuando un producto tenga menos unidades que esto. Aplica a todo tu
                        catálogo, salvo que le hayas puesto un umbral propio a algún producto en particular.
                        Si lo dejás vacío, se usa 2.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-settings">
                  {saveMutation.isPending ? "Guardando..." : "Guardar cambios"}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
