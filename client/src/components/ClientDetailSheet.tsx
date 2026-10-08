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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  CircleDollarSign,
  Plus,
} from "lucide-react";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";
import { formatArgentinaPhoneDisplay } from "@shared/phone";
import { paymentMethods, type PaymentMethod, type ClientNote, type ClientPayment } from "@shared/schema";
import { getEventTypeColorClass, getEventTypeLabel } from "./AppointmentCard";
import { WhatsAppButton } from "./WhatsAppButton";
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

// Prompt 6: de acá en más solo "pendiente"/"cancelada" — "entregado"/"pagado" eran valores
// permitidos que el código nunca llegó a escribir. Se dejan en el mapa por si una venta MUY
// vieja los tuviera, nunca se borra esa compatibilidad.
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

const paymentMethodLabels: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatShortDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Prompt 9, punto 2 — ni el cumpleaños ni su edad se muestran en ningún lado (auditado: ficha,
// lista, Inicio, Agenda, Reportes) — solo día y mes. parseLocalDate (no `new Date(iso)`, que
// parsea como UTC y en Argentina, UTC-3, puede mostrar el día anterior) evita ese corrimiento.
function formatBirthday(date?: string | null): string | null {
  if (!date) return null;
  return parseLocalDate(date).toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

type HistoryEntry =
  | { kind: "compra"; date: string; sale: SaleDetails }
  | { kind: "pago"; date: string; payment: ClientPayment };

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
  const { format } = useHideMoney();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(() => toDateInputValue(new Date()));
  const [payMethod, setPayMethod] = useState<PaymentMethod>("efectivo");
  const [newNoteText, setNewNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null);

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

  const paymentsQuery = useQuery<ClientPayment[]>({
    queryKey: ["/api/clients", client?.id, "payments"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${client!.id}/payments`);
      return res.json();
    },
    enabled: open && !!client,
  });

  const notesQuery = useQuery<ClientNote[]>({
    queryKey: ["/api/clients", client?.id, "notes"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${client!.id}/notes`);
      return res.json();
    },
    enabled: open && !!client,
  });

  const invalidateAfterMoneyChange = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients", client?.id, "sales"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients", client?.id, "payments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sales"] });
    queryClient.invalidateQueries({
      predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/reports"),
    });
  };

  // Prompt 9, punto 5 — "Registrar pago": aplica a TODAS las cuotas pendientes de la clienta,
  // de la más vieja a la más nueva, en una sola transacción del lado del servidor.
  const registerPaymentMutation = useGuardedMutation({
    mutationFn: async () => {
      const amountArs = Number(payAmount.replace(",", "."));
      const res = await apiRequest("POST", `/api/clients/${client!.id}/payments`, {
        amount: Math.round(amountArs * 100),
        date: payDate,
        paymentMethod: payMethod,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterMoneyChange();
      toast({ title: "Pago registrado" });
      setPayDialogOpen(false);
      setPayAmount("");
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo registrar el pago", description: err.message, variant: "destructive" });
    },
  });

  const addNoteMutation = useGuardedMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", `/api/clients/${client!.id}/notes`, { text });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", client?.id, "notes"] });
      setNewNoteText("");
      setAddingNote(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo guardar la nota", description: err.message, variant: "destructive" });
    },
  });

  const deleteNoteMutation = useGuardedMutation({
    mutationFn: async (noteId: number) => {
      await apiRequest("DELETE", `/api/clients/${client!.id}/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", client?.id, "notes"] });
      setDeletingNoteId(null);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo borrar la nota", description: err.message, variant: "destructive" });
    },
  });

  // Prompt 9, punto 5 — el borrado sigue bloqueado por completo si tiene ventas o citas (ver
  // storage.deleteClient): es la forma más segura de que "nunca se pierdan ventas ni cambien
  // los reportes" — directamente no se borra nada si hay historial. Por eso ya no hace falta
  // "Deshacer": una clienta que SÍ se llega a borrar nunca tenía nada que perder, y el texto
  // nuevo de confirmación ("no se puede deshacer") ya lo dice explícitamente.
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
      // Prompt 9, punto 1 — el mensaje bloqueado tiene un texto propio, claro y con el
      // nombre de la clienta, en vez del texto genérico que ya manda el backend (409).
      const nameForMessage = client?.name?.trim() || client?.phone || "esta clienta";
      const message =
        err instanceof ApiError && err.status === 409
          ? `No podés eliminar a ${nameForMessage} porque tiene ventas o citas registradas.`
          : err.message;
      toast({ title: "No se pudo eliminar la clienta", description: message, variant: "destructive" });
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

  // Prompt 9, punto 3 — "Historial" unifica compras y pagos (ya no "Actividad" separada de
  // "Historial" mostrando lo mismo dos veces) — las citas quedan en su propia pestaña, tal
  // como estaba.
  const history = useMemo<HistoryEntry[]>(() => {
    const saleEntries: HistoryEntry[] = (salesQuery.data ?? []).map((s) => ({ kind: "compra", date: s.date, sale: s }));
    const paymentEntries: HistoryEntry[] = (paymentsQuery.data ?? []).map((p) => ({ kind: "pago", date: p.date, payment: p }));
    return [...saleEntries, ...paymentEntries].sort((a, b) => b.date.localeCompare(a.date));
  }, [salesQuery.data, paymentsQuery.data]);

  if (!client) return null;

  const displayName = client.name?.trim() || client.phone || "Sin nombre";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const pendingBalance = client.pendingBalance ?? 0;
  const owesMoney = pendingBalance > 0;

  const openPayDialog = () => {
    setPayAmount((pendingBalance / 100).toFixed(2).replace(".", ","));
    setPayDate(toDateInputValue(new Date()));
    setPayMethod("efectivo");
    setPayDialogOpen(true);
  };

  const payAmountCents = Math.round(Number(payAmount.replace(",", ".")) * 100) || 0;
  const payAmountValid = payAmountCents > 0 && payAmountCents <= pendingBalance;

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
            {client.phone && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{formatArgentinaPhoneDisplay(client.phone)}</span>
                </div>
                <WhatsAppButton phone={client.phone} variant="full" />
              </div>
            )}
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

          {/* Prompt 9, punto 3 — tarjeta destacada SOLO si debe plata; si no debe nada, no se
             muestra nada en su lugar. */}
          {owesMoney && (
            <Card className="mt-4 border-amber-500/40 bg-amber-500/10" data-testid="card-client-owes">
              <CardContent className="py-4 space-y-3">
                <p className="text-lg font-bold text-amber-700 dark:text-amber-400" data-testid="text-client-owes-amount">
                  Te debe {format(pendingBalance)}
                </p>
                <div className="flex gap-2">
                  <Button type="button" className="flex-1" onClick={openPayDialog} data-testid="button-register-payment">
                    <CircleDollarSign className="h-4 w-4 mr-2" />
                    Registrar pago
                  </Button>
                  <WhatsAppButton phone={client.phone} variant="full" />
                </div>
              </CardContent>
            </Card>
          )}

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
                  <p className="text-lg font-bold tabular-nums" data-testid="text-summary-total">{format(summary.totalPurchased)}</p>
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
                  <p className="text-lg font-bold tabular-nums">{format(summary.avgTicket)}</p>
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

          {/* Prompt 9, punto 3 — "Nueva venta" pasa a ser el botón principal; "Editar" queda
             secundario; "Eliminar" queda al final, chico y sin relleno. */}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button className="flex-1 min-w-[140px]" onClick={() => onNewSale(client)} data-testid="button-new-sale-client">
              <ShoppingCart className="h-4 w-4 mr-2" />
              Nueva Venta
            </Button>
            <Button
              variant="outline"
              className="flex-1 min-w-[120px]"
              onClick={() => onEdit(client)}
              data-testid="button-edit-client-detail"
            >
              <Edit className="h-4 w-4 mr-2" />
              Editar
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-auto p-0 text-xs text-destructive hover:text-destructive"
            onClick={() => setDeleteConfirmOpen(true)}
            data-testid="button-delete-client"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Eliminar
          </Button>

          <Tabs defaultValue="historial" className="mt-6">
            <TabsList className="w-full">
              <TabsTrigger value="historial" className="flex-1">Historial</TabsTrigger>
              <TabsTrigger value="citas" className="flex-1">Citas</TabsTrigger>
              <TabsTrigger value="notas" className="flex-1">Notas</TabsTrigger>
            </TabsList>

            <TabsContent value="historial" className="mt-4 space-y-3">
              {salesQuery.isLoading || paymentsQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-md" />)}
                </div>
              ) : salesQuery.isError || paymentsQuery.isError ? (
                <ErrorBlock message="No se pudo cargar el historial de la clienta." />
              ) : history.length === 0 ? (
                <EmptyBlock message="Esta clienta todavía no tiene compras ni pagos registrados." />
              ) : (
                history.map((entry) =>
                  entry.kind === "compra" ? (
                    <Card key={`sale-${entry.sale.id}`} data-testid={`row-client-sale-${entry.sale.id}`}>
                      <CardContent className="py-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" />
                            <span>{formatShortDate(entry.sale.date)}</span>
                            <span className="text-xs">#{entry.sale.id}</span>
                          </div>
                          <Badge className={saleStatusColors[entry.sale.status] ?? saleStatusColors.pendiente}>
                            {saleStatusLabels[entry.sale.status] ?? entry.sale.status}
                          </Badge>
                        </div>
                        <div className="text-sm space-y-1">
                          {entry.sale.items.map((item) => (
                            <div key={item.id} className="flex justify-between gap-2">
                              <span className="truncate">{item.quantity} x {item.productName}</span>
                              <span className="tabular-nums shrink-0">{format(item.quantity * item.price)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-2 border-t text-sm">
                          <span className="text-muted-foreground">
                            Subtotal <span className="tabular-nums">{format(entry.sale.subtotal)}</span> · <span className="capitalize">{entry.sale.paymentMethod}</span>
                          </span>
                          {entry.sale.status !== "cancelada" && (
                            <span className="text-green-600 dark:text-green-400 tabular-nums">+{format(entry.sale.profit)}</span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card key={`payment-${entry.payment.id}`} data-testid={`row-client-payment-${entry.payment.id}`}>
                      <CardContent className="py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm">
                            <CircleDollarSign className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                            <span className="font-medium">Pago recibido</span>
                            <span className="text-xs text-muted-foreground">{formatShortDate(entry.payment.date)} · {paymentMethodLabels[entry.payment.paymentMethod as PaymentMethod] ?? entry.payment.paymentMethod}</span>
                          </div>
                          <span className="font-medium tabular-nums text-green-600 dark:text-green-400">+{format(entry.payment.amount)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ),
                )
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
                        <Badge className={getEventTypeColorClass(apt.type)}>{getEventTypeLabel(apt.type)}</Badge>
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

            <TabsContent value="notas" className="mt-4 space-y-3">
              {!addingNote ? (
                <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => setAddingNote(true)} data-testid="button-new-note">
                  <Plus className="h-4 w-4 mr-2" />
                  Nueva nota
                </Button>
              ) : (
                <div className="space-y-2">
                  <Textarea
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    rows={3}
                    placeholder="Escribí la nota..."
                    autoFocus
                    data-testid="input-new-note"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => { setAddingNote(false); setNewNoteText(""); }}>
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!newNoteText.trim() || addNoteMutation.isPending}
                      onClick={() => addNoteMutation.mutate(newNoteText.trim())}
                      data-testid="button-save-note"
                    >
                      Guardar
                    </Button>
                  </div>
                </div>
              )}

              {notesQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-md" />)}
                </div>
              ) : notesQuery.isError ? (
                <ErrorBlock message="No se pudieron cargar las notas." />
              ) : !notesQuery.data?.length ? (
                !addingNote && <EmptyBlock message="Sin notas" />
              ) : (
                notesQuery.data.map((note) => (
                  <Card key={note.id} data-testid={`row-client-note-${note.id}`}>
                    <CardContent className="py-3 flex items-start gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm whitespace-pre-wrap">{note.text}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {note.createdAt ? formatShortDate(toDateInputValue(new Date(note.createdAt))) : "Nota anterior"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => setDeletingNoteId(note.id)}
                        aria-label="Borrar nota"
                        data-testid={`button-delete-note-${note.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-delete-client">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Seguro que querés eliminar a {displayName}? Esta acción no se puede deshacer.</AlertDialogTitle>
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

      <AlertDialog open={deletingNoteId !== null} onOpenChange={(v) => !v && setDeletingNoteId(null)}>
        <AlertDialogContent data-testid="dialog-confirm-delete-note">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Querés borrar esta nota?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-delete-note-no">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={(e) => {
                e.preventDefault();
                if (deletingNoteId !== null) deleteNoteMutation.mutate(deletingNoteId);
              }}
              disabled={deleteNoteMutation.isPending}
              data-testid="button-confirm-delete-note-yes"
            >
              Sí, borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Prompt 9, punto 3 — "Registrar pago": monto completo con lo que debe (se puede
         cambiar para un pago parcial), fecha (hoy) y forma de pago. */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="max-w-sm" data-testid="dialog-register-payment">
          <DialogHeader>
            <DialogTitle>Registrar pago</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Monto</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                data-testid="input-pay-amount"
              />
              {!payAmountValid && payAmount && (
                <p className="text-xs text-destructive">
                  Tiene que ser mayor a 0 y no puede superar lo que debe ({format(pendingBalance)}).
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">Fecha</Label>
              <Input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} data-testid="input-pay-date" />
            </div>
            <div className="space-y-1.5">
              <Label>Forma de pago</Label>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PaymentMethod)}>
                <SelectTrigger data-testid="select-pay-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((m) => (
                    <SelectItem key={m} value={m}>{paymentMethodLabels[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPayDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!payAmountValid || registerPaymentMutation.isPending}
              onClick={() => registerPaymentMutation.mutate()}
              data-testid="button-confirm-register-payment"
            >
              {registerPaymentMutation.isPending ? "Registrando..." : "Registrar pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
