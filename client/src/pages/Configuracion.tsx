import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Consultant } from "@shared/schema";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings, Plus, Trash2 } from "lucide-react";

interface BusinessSettingsResponse extends Consultant {
  habitualDiscountPercent: number;
}

// El form trabaja los montos/porcentajes en texto (como el resto de inputs de dinero de la
// app); se convierten a su forma final recién al mandar al backend. `currency` nunca aparece
// en el form: siempre se manda "ARS" fijo (ver onSubmit), la app ya no la muestra ni la edita.
const formSchema = z
  .object({
    businessName: z.string().trim().min(1, "El nombre del negocio no puede estar vacío").max(120),
    monthlyGoal: z.string().optional(),
    orderReminderDay1: z.string().optional(),
    orderReminderDay2: z.string().optional(),
    defaultLowStockThreshold: z.string().optional(),
    grossIncomeTaxPercent: z.string().optional(),
  })
  .refine((v) => !v.orderReminderDay2 || v.orderReminderDay1, {
    message: "Para elegir un segundo día, primero elegí el primero",
    path: ["orderReminderDay2"],
  })
  .refine((v) => !v.orderReminderDay1 || !v.orderReminderDay2 || v.orderReminderDay1 !== v.orderReminderDay2, {
    message: "No podés elegir el mismo día dos veces",
    path: ["orderReminderDay2"],
  });
type FormData = z.infer<typeof formSchema>;

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

export default function Configuracion() {
  const { toast } = useToast();
  const [showSecondDay, setShowSecondDay] = useState(false);

  const { data: settings, isLoading, isError, error } = useQuery<BusinessSettingsResponse>({
    queryKey: ["/api/business-settings"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { businessName: "", monthlyGoal: "", orderReminderDay1: "", orderReminderDay2: "", defaultLowStockThreshold: "", grossIncomeTaxPercent: "" },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        businessName: settings.businessName,
        monthlyGoal: settings.monthlyGoal !== null ? String(settings.monthlyGoal / 100) : "",
        orderReminderDay1: settings.orderReminderDay1 !== null ? String(settings.orderReminderDay1) : "",
        orderReminderDay2: settings.orderReminderDay2 !== null ? String(settings.orderReminderDay2) : "",
        defaultLowStockThreshold:
          settings.defaultLowStockThreshold !== null ? String(settings.defaultLowStockThreshold) : "",
        grossIncomeTaxPercent:
          settings.grossIncomeTaxPercentTenths !== null ? String(settings.grossIncomeTaxPercentTenths / 10) : "",
      });
      setShowSecondDay(settings.orderReminderDay2 !== null);
    }
  }, [settings, form]);

  const saveMutation = useGuardedMutation({
    mutationFn: async (data: FormData) => {
      // Décimas de punto porcentual: acepta coma o punto (3,5 o 3.5).
      const grossIncomeTaxPercentTenths = data.grossIncomeTaxPercent
        ? Math.round(Number(data.grossIncomeTaxPercent.replace(",", ".")) * 10)
        : null;
      const res = await apiRequest("PATCH", "/api/business-settings", {
        businessName: data.businessName,
        currency: "ARS",
        monthlyGoal: data.monthlyGoal ? Math.round(Number(data.monthlyGoal) * 100) : null,
        orderReminderDay1: data.orderReminderDay1 ? Number(data.orderReminderDay1) : null,
        orderReminderDay2: data.orderReminderDay2 ? Number(data.orderReminderDay2) : null,
        defaultLowStockThreshold: data.defaultLowStockThreshold ? Math.round(Number(data.defaultLowStockThreshold)) : null,
        grossIncomeTaxPercentTenths,
      });
      return res.json() as Promise<Consultant>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-settings"] });
      toast({ title: "Cambios guardados" });
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
          <form onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Tu negocio</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
                  name="monthlyGoal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Objetivo de ventas del mes</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min={0} step="1" placeholder="Sin definir" data-testid="input-monthly-goal" />
                      </FormControl>
                      <FormDescription>Opcional. Se ve en Inicio.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pedidos y stock</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <FormLabel>¿Qué día del mes hacés tu pedido?</FormLabel>
                  <p className="text-xs text-muted-foreground">
                    Ese día te recordamos qué productos vendiste que tienen poco stock, para que los sumes a tu pedido.
                  </p>

                  <FormField
                    control={form.control}
                    name="orderReminderDay1"
                    render={({ field }) => (
                      <FormItem>
                        <Select value={field.value || undefined} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger data-testid="select-order-reminder-day1">
                              <SelectValue placeholder="Sin elegir" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {DAYS.map((d) => (
                              <SelectItem key={d} value={d}>{d}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {showSecondDay ? (
                    <FormField
                      control={form.control}
                      name="orderReminderDay2"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center gap-2">
                            <Select value={field.value || undefined} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger data-testid="select-order-reminder-day2">
                                  <SelectValue placeholder="Sin elegir" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {DAYS.map((d) => (
                                  <SelectItem key={d} value={d}>{d}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                field.onChange("");
                                setShowSecondDay(false);
                              }}
                              aria-label="Quitar el segundo día"
                              data-testid="button-remove-order-reminder-day2"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSecondDay(true)}
                      data-testid="button-add-order-reminder-day2"
                    >
                      <Plus className="h-4 w-4 mr-1.5" />
                      Agregar otro día
                    </Button>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Si elegís 29, 30 o 31 y el mes tiene menos días, te avisamos el último día del mes.
                  </p>
                </div>

                <FormField
                  control={form.control}
                  name="defaultLowStockThreshold"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Aviso de poco stock</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min={1} step="1" placeholder="2" data-testid="input-default-low-stock-threshold" />
                      </FormControl>
                      <FormDescription>
                        Avisarme cuando un producto tenga menos de esta cantidad de unidades. Para un producto
                        puntual lo podés cambiar desde Stock, editando el producto. Si lo dejás vacío, se usa 2.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-1">
                  <p className="text-sm font-medium">Tu descuento de compra habitual</p>
                  <p className="text-2xl font-bold" data-testid="text-habitual-discount">
                    {Math.round(settings?.habitualDiscountPercent ?? 35)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Lo calculamos con tus pedidos de los últimos 3 meses. Lo usamos para estimar tu ganancia cuando
                    un producto no tiene el costo cargado.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Impuestos</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="grossIncomeTaxPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ingresos Brutos (%)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Sin cargar" data-testid="input-gross-income-tax" />
                      </FormControl>
                      <FormDescription>
                        Si pagás Ingresos Brutos, poné el porcentaje y lo descontamos de tu ganancia (acepta decimales
                        con coma o punto, ej. 3,5). Si no pagás, dejalo vacío.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-settings">
              {saveMutation.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </form>
        </Form>
      )}
    </div>
  );
}
