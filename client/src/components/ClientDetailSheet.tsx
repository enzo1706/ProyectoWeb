import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Phone,
  Mail,
  MapPin,
  Calendar,
  Edit,
  ShoppingCart,
  Gift,
  Trash2,
  Clock,
  FileText,
  AlertTriangle,
  Inbox,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatPrice } from "@/lib/currency";
import { typeColors, typeLabels } from "./AppointmentCard";
import type { Appointment } from "@shared/schema";
import type { Client } from "./ClientCard";
import type { SaleDetails } from "./SaleCard";

interface ClientDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client | null;
  onEdit: (client: Client) => void;
  onNewSale: (client: Client) => void;
}

const saleStatusColors: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  entregado: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  pagado: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  cancelada: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const saleStatusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  entregado: "Entregado",
  pagado: "Pagado",
  cancelada: "Cancelada",
};

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatShortDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

type TimelineEntry =
  | { kind: "compra"; date: string; sale: SaleDetails }
  | { kind: "cita"; date: string; appointment: Appointment };

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center" data-testid="client-detail-empty">
      <Inbox className="h-7 w-7 text-muted-foreground mb-2" />
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
      data-testid="client-detail-error"
    >
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <p className="text-sm text-destructive">{message}</p>
    </div>
  );
}

export function ClientDetailSheet({ open, onOpenChange, client, onEdit, onNewSale }: ClientDetailSheetProps) {
  const { toast } = useToast();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const salesQuery = useQuery<SaleDetails[]>({
    queryKey: ["/api/clients", client?.id, "sales"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${client!.id}/sales`);
      return res.json();
    },
    enabled: open && !!client,
  });

  const appointmentsQuery = useQuery<Appointment[]>({
    queryKey: ["/api/clients", client?.id, "appointments"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${client!.id}/appointments`);
      return res.json();
    },
    enabled: open && !!client,
  });

  const deleteMutation = useGuardedMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/clients/${client!.id}`);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Clienta eliminada" });
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo eliminar la clienta", description: err.message, variant: "destructive" });
    },
  });

  const activeSales = useMemo(
    () => (salesQuery.data ?? []).filter((s) => s.status !== "cancelada"),
    [salesQuery.data],
  );

  const summary = useMemo(() => {
    if (activeSales.length === 0) {
      return { totalPurchased: 0, purchaseCount: 0, avgTicket: 0, firstPurchase: null as string | null, lastPurchase: null as string | null, totalProducts: 0 };
    }
    const totalPurchased = activeSales.reduce((sum, s) => sum + s.total, 0);
    const purchaseCount = activeSales.length;
    const avgTicket = Math.round(totalPurchased / purchaseCount);
    const sortedDates = [...activeSales.map((s) => s.date)].sort();
    const totalProducts = activeSales.reduce((sum, s) => sum + s.items.reduce((isum, i) => isum + i.quantity, 0), 0);
    return {
      totalPurchased,
      purchaseCount,
      avgTicket,
      firstPurchase: sortedDates[0],
      lastPurchase: sortedDates[sortedDates.length - 1],
      totalProducts,
    };
  }, [activeSales]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const saleEntries: TimelineEntry[] = (salesQuery.data ?? []).map((s) => ({ kind: "compra", date: s.date, sale: s }));
    const aptEntries: TimelineEntry[] = (appointmentsQuery.data ?? []).map((a) => ({ kind: "cita", date: a.date, appointment: a }));
    return [...saleEntries, ...aptEntries].sort((a, b) => b.date.localeCompare(a.date));
  }, [salesQuery.data, appointmentsQuery.data]);

  if (!client) return null;

  const displayName = client.name?.trim() || client.phone;
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const formatBirthday = (date?: string | null) => {
    if (!date) return null;
    const d = new Date(date);
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="sheet-client-detail">
          <SheetHeader className="text-left">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16 border-2 border-border">
                <AvatarFallback className="bg-primary/10 text-primary text-xl font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-xl">{displayName}</SheetTitle>
              </div>
            </div>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-3 text-sm">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{client.phone}</span>
            </div>
            {client.email && (
              <div className="flex items-center gap-3 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{client.email}</span>
              </div>
            )}
            {client.address && (
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{client.address}</span>
              </div>
            )}
            {client.birthday && (
              <div className="flex items-center gap-3 text-sm">
                <Gift className="h-4 w-4 text-muted-foreground" />
                <span>Cumpleaños: {formatBirthday(client.birthday)}</span>
              </div>
            )}
          </div>

          {salesQuery.isLoading ? (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-lg" />)}
            </div>
          ) : salesQuery.isError ? (
            <div className="mt-6">
              <ErrorBlock message="No se pudo cargar el resumen de compras." />
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="client-summary">
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-lg font-bold tabular-nums" data-testid="text-summary-total">{formatPrice(summary.totalPurchased)}</p>
                  <p className="text-xs text-muted-foreground">Total Comprado</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-lg font-bold tabular-nums">{summary.purchaseCount}</p>
                  <p className="text-xs text-muted-foreground">Compras</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-lg font-bold tabular-nums">{formatPrice(summary.avgTicket)}</p>
                  <p className="text-xs text-muted-foreground">Ticket Promedio</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-lg font-bold">{summary.lastPurchase ? formatShortDate(summary.lastPurchase) : "-"}</p>
                  <p className="text-xs text-muted-foreground">Última Compra</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-lg font-bold">{summary.firstPurchase ? formatShortDate(summary.firstPurchase) : "-"}</p>
                  <p className="text-xs text-muted-foreground">Primera Compra</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 text-center">
                  <p className="text-lg font-bold tabular-nums">{summary.totalProducts}</p>
                  <p className="text-xs text-muted-foreground">Productos</p>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <Button className="flex-1 min-w-[120px]" onClick={() => onEdit(client)} data-testid="button-edit-client-detail">
              <Edit className="h-4 w-4 mr-2" />
              Editar
            </Button>
            <Button
              variant="outline"
              className="flex-1 min-w-[120px]"
              onClick={() => onNewSale(client)}
              data-testid="button-new-sale-client"
            >
              <ShoppingCart className="h-4 w-4 mr-2" />
              Nueva Venta
            </Button>
            <Button
              variant="destructive"
              className="flex-1 min-w-[120px]"
              onClick={() => setDeleteConfirmOpen(true)}
              data-testid="button-delete-client"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Eliminar
            </Button>
          </div>

          <Tabs defaultValue="historial" className="mt-6">
            <TabsList className="w-full">
              <TabsTrigger value="actividad" className="flex-1">Actividad</TabsTrigger>
              <TabsTrigger value="historial" className="flex-1">Historial</TabsTrigger>
              <TabsTrigger value="citas" className="flex-1">Citas</TabsTrigger>
              <TabsTrigger value="notas" className="flex-1">Notas</TabsTrigger>
            </TabsList>

            <TabsContent value="actividad" className="mt-4 space-y-3">
              {salesQuery.isLoading || appointmentsQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-md" />)}
                </div>
              ) : salesQuery.isError || appointmentsQuery.isError ? (
                <ErrorBlock message="No se pudo cargar la actividad de la clienta." />
              ) : timeline.length === 0 ? (
                <EmptyBlock message="Todavía no hay actividad registrada para esta clienta." />
              ) : (
                timeline.map((entry) =>
                  entry.kind === "compra" ? (
                    <Card key={`sale-${entry.sale.id}`} data-testid={`timeline-sale-${entry.sale.id}`}>
                      <CardContent className="py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <ShoppingCart className="h-3.5 w-3.5" />
                            <span>{formatShortDate(entry.date)}</span>
                            <Badge className={saleStatusColors[entry.sale.status] ?? saleStatusColors.pendiente}>
                              {saleStatusLabels[entry.sale.status] ?? entry.sale.status}
                            </Badge>
                          </div>
                          <span className="font-medium tabular-nums">{formatPrice(entry.sale.total)}</span>
                        </div>
                        <p className="text-sm mt-1 text-muted-foreground truncate">
                          {entry.sale.items.map((i) => i.productName).join(", ")}
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card key={`apt-${entry.appointment.id}`} data-testid={`timeline-appointment-${entry.appointment.id}`}>
                      <CardContent className="py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" />
                            <span>{formatShortDate(entry.date)} · {entry.appointment.time}</span>
                          </div>
                          <Badge className={typeColors[entry.appointment.type] ?? ""}>
                            {typeLabels[entry.appointment.type] ?? entry.appointment.type}
                          </Badge>
                        </div>
                        {entry.appointment.notes && (
                          <p className="text-sm mt-1 text-muted-foreground truncate">{entry.appointment.notes}</p>
                        )}
                      </CardContent>
                    </Card>
                  ),
                )
              )}
            </TabsContent>

            <TabsContent value="historial" className="mt-4 space-y-3">
              {salesQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-md" />)}
                </div>
              ) : salesQuery.isError ? (
                <ErrorBlock message="No se pudo cargar el historial de compras." />
              ) : !salesQuery.data?.length ? (
                <EmptyBlock message="Esta clienta todavía no tiene compras registradas." />
              ) : (
                salesQuery.data.map((sale) => (
                  <Card key={sale.id} data-testid={`row-client-sale-${sale.id}`}>
                    <CardContent className="py-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>{formatShortDate(sale.date)}</span>
                          <span className="text-xs">#{sale.id}</span>
                        </div>
                        <Badge className={saleStatusColors[sale.status] ?? saleStatusColors.pendiente}>
                          {saleStatusLabels[sale.status] ?? sale.status}
                        </Badge>
                      </div>

                      <div className="text-sm space-y-1">
                        {sale.items.map((item) => (
                          <div key={item.id} className="flex justify-between gap-2">
                            <span className="truncate">{item.quantity} x {item.productName}</span>
                            <span className="tabular-nums shrink-0">{formatPrice(item.quantity * item.price)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t text-sm">
                        <span className="text-muted-foreground">
                          Subtotal <span className="tabular-nums">{formatPrice(sale.subtotal)}</span> · <span className="capitalize">{sale.paymentMethod}</span>
                        </span>
                        {sale.status !== "cancelada" && (
                          <span className="text-green-600 dark:text-green-400 tabular-nums">+{formatPrice(sale.profit)}</span>
                        )}
                      </div>

                      {sale.installments.length > 1 && (
                        <div className="text-xs text-muted-foreground">
                          {sale.installments.length} cuotas: {sale.installments.map((i) => `${formatPrice(i.amount)} (${i.status})`).join(", ")}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="citas" className="mt-4 space-y-3">
              {appointmentsQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-md" />)}
                </div>
              ) : appointmentsQuery.isError ? (
                <ErrorBlock message="No se pudieron cargar las citas." />
              ) : !appointmentsQuery.data?.length ? (
                <EmptyBlock message="No hay citas registradas para esta clienta." />
              ) : (
                appointmentsQuery.data.map((apt) => (
                  <Card key={apt.id} data-testid={`row-client-appointment-${apt.id}`}>
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{formatShortDate(apt.date)} · {apt.time}</span>
                        </div>
                        <Badge className={typeColors[apt.type] ?? ""}>{typeLabels[apt.type] ?? apt.type}</Badge>
                      </div>
                      {apt.location && (
                        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate">{apt.location}</span>
                        </div>
                      )}
                      {apt.notes && <p className="mt-1 text-sm text-muted-foreground">{apt.notes}</p>}
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="notas" className="mt-4">
              {client.notes ? (
                <Card>
                  <CardContent className="py-4 flex items-start gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-sm">{client.notes}</p>
                  </CardContent>
                </Card>
              ) : (
                <EmptyBlock message="Sin notas" />
              )}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-delete-client">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar a {displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Si la clienta tiene ventas o citas registradas, no se va a poder
              eliminar — esos datos se conservan siempre para no perder historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-delete-no">No, volver</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-yes"
            >
              {deleteMutation.isPending ? "Eliminando..." : "Sí, eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
