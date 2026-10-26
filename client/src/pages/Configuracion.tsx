import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { normalizeArgentinaPhoneDigits } from "@shared/phone";
import { WHATSAPP_FORMAT_HINT } from "@/lib/phoneHint";
import {
  activatePushNotifications,
  getCurrentSubscriptionEndpoint,
  isPushSupported,
  needsIosHomeScreenInstall,
  sendTestPush,
} from "@/lib/pushNotifications";
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
import { MoneyInput } from "@/components/MoneyInput";
import { PercentInput } from "@/components/PercentInput";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
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

/** Prompt 14 — Configuración → "Tus datos": nombre, email, WhatsApp, ciudad, edad y cargo.
 * Form propio, separado del de "Tu negocio" (otro endpoint, otra regla: cambiar email o
 * WhatsApp exige la contraseña actual). */
function TusDatosCard({ settings }: { settings: BusinessSettingsResponse | undefined }) {
  const { toast } = useToast();
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [city, setCity] = useState("");
  const [age, setAge] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  useEffect(() => {
    if (!settings) return;
    setContactName(settings.contactName ?? "");
    setEmail(settings.email ?? "");
    setWhatsapp(settings.whatsapp ?? "");
    setCity(settings.city ?? "");
    setAge(settings.age !== null ? String(settings.age) : "");
    setJobTitle(settings.jobTitle ?? "");
  }, [settings]);

  const emailChanged = email.trim() !== (settings?.email ?? "");
  const whatsappChanged = whatsapp.trim() !== (settings?.whatsapp ?? "");
  const needsCurrentPassword = emailChanged || whatsappChanged;
  const invalidWhatsapp = whatsapp.trim() !== "" && !normalizeArgentinaPhoneDigits(whatsapp).valid;

  const mutation = useGuardedMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/consultant/profile", {
        contactName: contactName.trim() || null,
        email: email.trim() || null,
        whatsapp: whatsapp.trim() || null,
        city: city.trim() || null,
        age: age.trim() ? Number(age) : null,
        jobTitle: jobTitle.trim() || null,
        ...(needsCurrentPassword ? { currentPassword } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-settings"] });
      setCurrentPassword("");
      toast({ title: "Tus datos se guardaron" });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudieron guardar tus datos", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Tus datos</CardTitle>
        <CardDescription>Tu nombre, cómo te contactamos y cómo entrás a la cuenta.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="profile-contact-name">Nombre y apellido</Label>
          <Input
            id="profile-contact-name"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            data-testid="input-profile-contact-name"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-email">Email</Label>
          <Input
            id="profile-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="input-profile-email"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-whatsapp">WhatsApp</Label>
          <Input
            id="profile-whatsapp"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="261 555 1234"
            data-testid="input-profile-whatsapp"
          />
          {invalidWhatsapp && (
            <p className="text-sm text-destructive" data-testid="text-profile-whatsapp-hint">
              {WHATSAPP_FORMAT_HINT}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-city">Ciudad</Label>
          <Input id="profile-city" value={city} onChange={(e) => setCity(e.target.value)} data-testid="input-profile-city" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-age">Edad</Label>
          <Input
            id="profile-age"
            type="number"
            min={14}
            max={100}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            data-testid="input-profile-age"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-job-title">Tu cargo</Label>
          <Input
            id="profile-job-title"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="Consultora, Directora..."
            data-testid="input-profile-job-title"
          />
        </div>
        {needsCurrentPassword && (
          <div className="space-y-1.5">
            <Label htmlFor="profile-current-password">Contraseña actual</Label>
            <PasswordInput
              id="profile-current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              data-testid="input-profile-current-password"
            />
            <p className="text-xs text-muted-foreground">Para cambiar el email o el WhatsApp, confirmá tu contraseña actual.</p>
          </div>
        )}
        <Button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || invalidWhatsapp || (needsCurrentPassword && !currentPassword)}
          data-testid="button-save-profile-data"
        >
          {mutation.isPending ? "Guardando..." : "Guardar"}
        </Button>
      </CardContent>
    </Card>
  );
}

interface BusinessSettingsResponse extends Consultant {
  habitualDiscountPercent: number;
}

// El form trabaja los montos/porcentajes en texto (como el resto de inputs de dinero de la
// app); se convierten a su forma final recién al mandar al backend. `currency` nunca aparece
// en el form: siempre se manda "ARS" fijo (ver onSubmit), la app ya no la muestra ni la edita.
const formSchema = z
  .object({
    businessName: z.string().trim().min(1, "El nombre del negocio no puede estar vacío").max(120),
    orderReminderDay1: z.string().optional(),
    orderReminderDay2: z.string().optional(),
    defaultLowStockThreshold: z.string().optional(),
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

  // Prompt 8, Parte 4 — "Activar avisos en este celular". Se detecta solo si YA están
  // activados en este dispositivo (hay una suscripción push guardada por el navegador) —
  // nunca se pide permiso ni se registra nada hasta que la consultora toca el botón.
  const [pushActivationStatus, setPushActivationStatus] = useState<"cargando" | "activo" | "inactivo" | "denegado">("cargando");
  const [isActivatingPush, setIsActivatingPush] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);

  useEffect(() => {
    getCurrentSubscriptionEndpoint().then((endpoint) => {
      setPushActivationStatus(endpoint ? "activo" : "inactivo");
    });
  }, []);

  const handleActivatePush = async () => {
    setIsActivatingPush(true);
    try {
      const result = await activatePushNotifications();
      if (result.status === "activado") {
        setPushActivationStatus("activo");
        toast({ title: "Avisos activados en este celular ✓" });
      } else if (result.status === "permiso-denegado") {
        setPushActivationStatus("denegado");
      } else if (result.status === "no-soportado") {
        toast({ title: "Este navegador no permite avisos push", variant: "destructive" });
      } else {
        toast({ title: "No se pudieron activar los avisos", description: result.message, variant: "destructive" });
      }
    } finally {
      setIsActivatingPush(false);
    }
  };

  const handleTestPush = async () => {
    setIsTestingPush(true);
    try {
      const result = await sendTestPush();
      if (result.ok) {
        toast({ title: "Aviso de prueba mandado — revisá las notificaciones de tu celular" });
      } else {
        toast({ title: "No se pudo mandar el aviso de prueba", description: result.message, variant: "destructive" });
      }
    } finally {
      setIsTestingPush(false);
    }
  };

  const { data: settings, isLoading, isError, error } = useQuery<BusinessSettingsResponse>({
    queryKey: ["/api/business-settings"],
  });

  const [monthlyGoalCents, setMonthlyGoalCents] = useState<number | null>(null);
  const [grossIncomeTaxPercent, setGrossIncomeTaxPercent] = useState<number | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { businessName: "", orderReminderDay1: "", orderReminderDay2: "", defaultLowStockThreshold: "" },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        businessName: settings.businessName,
        orderReminderDay1: settings.orderReminderDay1 !== null ? String(settings.orderReminderDay1) : "",
        orderReminderDay2: settings.orderReminderDay2 !== null ? String(settings.orderReminderDay2) : "",
        defaultLowStockThreshold:
          settings.defaultLowStockThreshold !== null ? String(settings.defaultLowStockThreshold) : "",
      });
      setMonthlyGoalCents(settings.monthlyGoal);
      setGrossIncomeTaxPercent(settings.grossIncomeTaxPercentTenths !== null ? settings.grossIncomeTaxPercentTenths / 10 : null);
      setShowSecondDay(settings.orderReminderDay2 !== null);
    }
  }, [settings, form]);

  const saveMutation = useGuardedMutation({
    mutationFn: async (data: FormData) => {
      const grossIncomeTaxPercentTenths = grossIncomeTaxPercent !== null ? Math.round(grossIncomeTaxPercent * 10) : null;
      const res = await apiRequest("PATCH", "/api/business-settings", {
        businessName: data.businessName,
        currency: "ARS",
        monthlyGoal: monthlyGoalCents,
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
        <div className="space-y-6">
          <TusDatosCard settings={settings} />

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

                <FormItem>
                  <FormLabel>Objetivo de ventas del mes</FormLabel>
                  <FormControl>
                    <MoneyInput
                      unit="cents"
                      value={monthlyGoalCents}
                      onChange={setMonthlyGoalCents}
                      placeholder="Sin definir"
                      data-testid="input-monthly-goal"
                    />
                  </FormControl>
                  <FormDescription>Opcional. Se ve en Inicio.</FormDescription>
                </FormItem>
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

                <div className="space-y-2 border-t pt-4">
                  <p className="text-sm font-medium">Avisos en tu celular</p>
                  <p className="text-xs text-muted-foreground">
                    El día de pedido te mandamos un aviso como los de WhatsApp, además del recordatorio que ya ves
                    en Inicio.
                  </p>

                  {needsIosHomeScreenInstall() ? (
                    <p className="text-sm" data-testid="text-push-ios-instructions">
                      Tocá <strong>Compartir</strong> y después <strong>"Agregar a inicio"</strong>. Abrí Impulsa
                      desde ese ícono y activá los avisos.
                    </p>
                  ) : !isPushSupported() ? (
                    <p className="text-xs text-muted-foreground">
                      Este navegador no permite avisos push.
                    </p>
                  ) : pushActivationStatus === "activo" ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-green-600" data-testid="text-push-activated">
                        Avisos activados en este celular ✓
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleTestPush}
                        disabled={isTestingPush}
                        data-testid="button-test-push"
                      >
                        {isTestingPush ? "Mandando..." : "Probar aviso"}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleActivatePush}
                        disabled={isActivatingPush || pushActivationStatus === "cargando"}
                        data-testid="button-activate-push"
                      >
                        {isActivatingPush ? "Activando..." : "Activar avisos en este celular"}
                      </Button>
                      {pushActivationStatus === "denegado" && (
                        <p className="text-xs text-muted-foreground" data-testid="text-push-denied">
                          Rechazaste el permiso de notificaciones. Para activarlo, entrá a la configuración del
                          navegador para este sitio y habilitá las notificaciones.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Impuestos</CardTitle>
              </CardHeader>
              <CardContent>
                <FormItem>
                  <FormLabel>Ingresos brutos (%)</FormLabel>
                  <FormControl>
                    <PercentInput
                      value={grossIncomeTaxPercent}
                      onChange={setGrossIncomeTaxPercent}
                      placeholder="Sin cargar"
                      data-testid="input-gross-income-tax"
                    />
                  </FormControl>
                  <FormDescription>
                    Si pagás Ingresos Brutos, poné el porcentaje y lo descontamos de tu ganancia (acepta decimales
                    con coma o punto, ej. 3,5). Si no pagás, dejalo vacío.
                  </FormDescription>
                </FormItem>
              </CardContent>
            </Card>

            <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-settings">
              {saveMutation.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </form>
        </Form>
        </div>
      )}
    </div>
  );
}
