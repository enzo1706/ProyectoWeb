import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CreditCard, Users, Clock, CheckCircle2, AlertTriangle, Ban } from "lucide-react";

type SubscriptionStatus = "trial" | "active" | "expired" | "canceled";
type PaymentStatus = "pending" | "approved" | "rejected" | "cancelled" | "in_process";

interface AdminSubscriptionRow {
  consultantId: number;
  businessName: string;
  username: string;
  email: string | null;
  status: SubscriptionStatus;
  hasAccess: boolean;
  daysRemaining: number;
  trialStartAt: string | null;
  trialEndAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  mpPreapprovalId: string | null;
  lastPayment: {
    id: number;
    mpPaymentId: string | null;
    amount: number;
    currency: string;
    status: PaymentStatus;
    paidAt: string | null;
  } | null;
}

interface AdminSubscriptionsResponse {
  summary: { total: number; trial: number; active: number; expired: number; canceled: number };
  rows: AdminSubscriptionRow[];
}

interface AdminPaymentRow {
  id: number;
  consultantId: number;
  businessName: string;
  externalReference: string;
  mpPreapprovalId: string | null;
  mpPaymentId: string | null;
  status: PaymentStatus;
  amount: number;
  currency: string;
  periodDaysGranted: number;
  mpStatusDetail: string | null;
  createdAt: string;
  paidAt: string | null;
}

interface AdminPaymentsResponse {
  summary: { totalPayments: number; approvedCount: number; approvedRevenue: number };
  rows: AdminPaymentRow[];
}

const STATUS_META: Record<SubscriptionStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  trial: { label: "Prueba", variant: "secondary" },
  active: { label: "Activa", variant: "default" },
  expired: { label: "Vencida", variant: "destructive" },
  canceled: { label: "Cancelada", variant: "outline" },
};

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
  cancelled: "Cancelado",
  in_process: "En proceso",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatMoney(amount: number, currency: string): string {
  return `$${amount.toLocaleString("es-AR")} ${currency}`;
}

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant={meta.variant} data-testid={`badge-status-${status}`}>
      {meta.label}
    </Badge>
  );
}

function SummaryTiles({ summary }: { summary: AdminSubscriptionsResponse["summary"] }) {
  const tiles = [
    { label: "Total", value: summary.total, icon: Users, testId: "total" },
    { label: "En prueba", value: summary.trial, icon: Clock, testId: "trial" },
    { label: "Activas", value: summary.active, icon: CheckCircle2, testId: "active" },
    { label: "Vencidas", value: summary.expired, icon: AlertTriangle, testId: "expired" },
    { label: "Canceladas", value: summary.canceled, icon: Ban, testId: "canceled" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {tiles.map((tile) => (
        <Card key={tile.label} data-testid={`summary-${tile.testId}`}>
          <CardContent className="p-4 flex items-center gap-3">
            <tile.icon className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-2xl font-bold leading-none">{tile.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{tile.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ConsultantDetailDialog({ consultantId, businessName, onClose }: { consultantId: number; businessName: string; onClose: () => void }) {
  const { data: row } = useQuery<AdminSubscriptionRow | undefined>({
    queryKey: ["/api/admin/subscriptions"],
    select: (data: any) => (data as AdminSubscriptionsResponse).rows.find((r) => r.consultantId === consultantId),
  });
  const { data: payments = [], isLoading } = useQuery<AdminPaymentRow[]>({
    queryKey: [`/api/admin/subscriptions/${consultantId}/payments`],
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-subscription-detail">
        <DialogHeader>
          <DialogTitle>{businessName}</DialogTitle>
          <DialogDescription>Detalle de suscripción y pagos</DialogDescription>
        </DialogHeader>

        {row && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">Suscripción</h3>
              <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estado</span>
                  <StatusBadge status={row.status} />
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Acceso actual</span>
                  <span className="font-medium">{row.hasAccess ? "Habilitado" : "Bloqueado"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Prueba (trial)</span>
                  <span className="font-medium">{formatDate(row.trialStartAt)} — {formatDate(row.trialEndAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Período pago actual</span>
                  <span className="font-medium">
                    {row.currentPeriodStart ? `${formatDate(row.currentPeriodStart)} — ${formatDate(row.currentPeriodEnd)}` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Días restantes</span>
                  <span className="font-medium">{row.daysRemaining}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">Mercado Pago</h3>
              <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">Preapproval ID</span>
                  <span className="font-mono text-xs break-all text-right">{row.mpPreapprovalId ?? "—"}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">Historial de pagos</h3>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Cargando...</p>
              ) : payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no tiene pagos registrados.</p>
              ) : (
                <div className="space-y-2">
                  {payments.map((p) => (
                    <div key={p.id} className="rounded-lg border p-3 text-sm flex items-center justify-between gap-2" data-testid={`row-payment-${p.id}`}>
                      <div>
                        <p className="font-medium">{formatMoney(p.amount, p.currency)}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(p.paidAt ?? p.createdAt)}</p>
                      </div>
                      <Badge variant={p.status === "approved" ? "default" : p.status === "rejected" || p.status === "cancelled" ? "destructive" : "secondary"}>
                        {PAYMENT_STATUS_LABELS[p.status]}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SubscriptionsTab() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedConsultant, setSelectedConsultant] = useState<{ id: number; businessName: string } | null>(null);

  const queryString = statusFilter !== "all" ? `?status=${statusFilter}` : "";
  const { data, isLoading } = useQuery<AdminSubscriptionsResponse>({
    queryKey: [`/api/admin/subscriptions${queryString}`],
  });

  return (
    <div className="space-y-4">
      {data && <SummaryTiles summary={data.summary} />}

      <div className="flex items-center gap-2">
        <Label htmlFor="select-status-filter" className="text-sm text-muted-foreground shrink-0">
          Estado
        </Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger id="select-status-filter" className="w-48" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="trial">En prueba</SelectItem>
            <SelectItem value="active">Activas</SelectItem>
            <SelectItem value="expired">Vencidas</SelectItem>
            <SelectItem value="canceled">Canceladas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="rounded-lg border bg-card shadow-sm p-8 text-center text-muted-foreground">Cargando...</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="rounded-lg border bg-card shadow-sm p-8 text-center text-muted-foreground">No hay consultoras para este filtro.</div>
      ) : (
        <>
          {/* Desktop/tablet: tabla */}
          <div className="hidden sm:block rounded-lg border bg-card shadow-sm overflow-hidden overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted">
                  <TableHead className="text-foreground font-semibold">Consultora</TableHead>
                  <TableHead className="text-foreground font-semibold">Estado</TableHead>
                  <TableHead className="text-foreground font-semibold">Vence</TableHead>
                  <TableHead className="text-foreground font-semibold">Último pago</TableHead>
                  <TableHead className="text-foreground font-semibold text-right">Acceso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow
                    key={row.consultantId}
                    className="cursor-pointer"
                    onClick={() => setSelectedConsultant({ id: row.consultantId, businessName: row.businessName })}
                    data-testid={`row-subscription-${row.consultantId}`}
                  >
                    <TableCell className="font-medium">
                      {row.businessName}
                      <p className="text-xs text-muted-foreground font-normal">{row.username}</p>
                    </TableCell>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="text-sm">{formatDate(row.currentPeriodEnd ?? row.trialEndAt)}</TableCell>
                    <TableCell className="text-sm">
                      {row.lastPayment ? formatMoney(row.lastPayment.amount, row.lastPayment.currency) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={row.hasAccess ? "default" : "destructive"}>{row.hasAccess ? "Habilitado" : "Bloqueado"}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <div className="sm:hidden space-y-3">
            {data.rows.map((row) => (
              <button
                key={row.consultantId}
                type="button"
                className="w-full text-left rounded-lg border bg-card shadow-sm p-4 space-y-2"
                onClick={() => setSelectedConsultant({ id: row.consultantId, businessName: row.businessName })}
                data-testid={`row-subscription-mobile-${row.consultantId}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">{row.businessName}</p>
                  <StatusBadge status={row.status} />
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Vence: {formatDate(row.currentPeriodEnd ?? row.trialEndAt)}</span>
                  <Badge variant={row.hasAccess ? "default" : "destructive"} className="shrink-0">
                    {row.hasAccess ? "Habilitado" : "Bloqueado"}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {selectedConsultant && (
        <ConsultantDetailDialog
          consultantId={selectedConsultant.id}
          businessName={selectedConsultant.businessName}
          onClose={() => setSelectedConsultant(null)}
        />
      )}
    </div>
  );
}

function PaymentsTab() {
  const [status, setStatus] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const queryString = params.toString() ? `?${params.toString()}` : "";

  const { data, isLoading } = useQuery<AdminPaymentsResponse>({
    queryKey: [`/api/admin/payments${queryString}`],
  });

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card data-testid="summary-total-payments">
            <CardContent className="p-4">
              <p className="text-2xl font-bold">{data.summary.totalPayments}</p>
              <p className="text-xs text-muted-foreground mt-1">Pagos totales (filtro actual)</p>
            </CardContent>
          </Card>
          <Card data-testid="summary-approved-count">
            <CardContent className="p-4">
              <p className="text-2xl font-bold">{data.summary.approvedCount}</p>
              <p className="text-xs text-muted-foreground mt-1">Pagos aprobados</p>
            </CardContent>
          </Card>
          <Card data-testid="summary-approved-revenue">
            <CardContent className="p-4">
              <p className="text-2xl font-bold">${data.summary.approvedRevenue.toLocaleString("es-AR")}</p>
              <p className="text-xs text-muted-foreground mt-1">Ingresos aprobados (ARS)</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="select-payment-status" className="text-xs text-muted-foreground">Estado del pago</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="select-payment-status" className="w-44" data-testid="select-payment-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="approved">Aprobado</SelectItem>
              <SelectItem value="pending">Pendiente</SelectItem>
              <SelectItem value="rejected">Rechazado</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
              <SelectItem value="in_process">En proceso</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="input-payments-from" className="text-xs text-muted-foreground">Desde</Label>
          <Input id="input-payments-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" data-testid="input-payments-from" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="input-payments-to" className="text-xs text-muted-foreground">Hasta</Label>
          <Input id="input-payments-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" data-testid="input-payments-to" />
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border bg-card shadow-sm p-8 text-center text-muted-foreground">Cargando...</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="rounded-lg border bg-card shadow-sm p-8 text-center text-muted-foreground">No hay pagos para este filtro.</div>
      ) : (
        <>
          <div className="hidden sm:block rounded-lg border bg-card shadow-sm overflow-hidden overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted">
                  <TableHead className="text-foreground font-semibold">Consultora</TableHead>
                  <TableHead className="text-foreground font-semibold">Fecha</TableHead>
                  <TableHead className="text-foreground font-semibold">Monto</TableHead>
                  <TableHead className="text-foreground font-semibold">Estado</TableHead>
                  <TableHead className="text-foreground font-semibold">Payment ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((p) => (
                  <TableRow key={p.id} data-testid={`row-admin-payment-${p.id}`}>
                    <TableCell className="font-medium">{p.businessName}</TableCell>
                    <TableCell className="text-sm">{formatDate(p.paidAt ?? p.createdAt)}</TableCell>
                    <TableCell className="text-sm">{formatMoney(p.amount, p.currency)}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "approved" ? "default" : p.status === "rejected" || p.status === "cancelled" ? "destructive" : "secondary"}>
                        {PAYMENT_STATUS_LABELS[p.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{p.mpPaymentId ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="sm:hidden space-y-3">
            {data.rows.map((p) => (
              <div key={p.id} className="rounded-lg border bg-card shadow-sm p-4 space-y-2" data-testid={`row-admin-payment-mobile-${p.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">{p.businessName}</p>
                  <Badge variant={p.status === "approved" ? "default" : p.status === "rejected" || p.status === "cancelled" ? "destructive" : "secondary"}>
                    {PAYMENT_STATUS_LABELS[p.status]}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatDate(p.paidAt ?? p.createdAt)}</span>
                  <span className="font-medium text-foreground">{formatMoney(p.amount, p.currency)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function SubscriptionManagement() {
  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="page-subscription-management">
      <div>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <CreditCard className="h-7 w-7 text-primary" />
          Suscripciones
        </h1>
        <p className="text-muted-foreground mt-1">Estado comercial de las consultoras y pagos de Mercado Pago</p>
      </div>

      <Tabs defaultValue="suscripciones">
        <TabsList>
          <TabsTrigger value="suscripciones" data-testid="tab-suscripciones">Suscripciones</TabsTrigger>
          <TabsTrigger value="pagos" data-testid="tab-pagos">Pagos</TabsTrigger>
        </TabsList>
        <TabsContent value="suscripciones" className="mt-4">
          <SubscriptionsTab />
        </TabsContent>
        <TabsContent value="pagos" className="mt-4">
          <PaymentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
