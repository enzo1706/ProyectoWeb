import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSaleCart } from "@/hooks/use-sale-cart";
import { useSaleDialog } from "@/hooks/use-sale-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SaleCard, type Sale } from "@/components/SaleCard";
import { SaleDetailDialog } from "@/components/SaleDetailDialog";
import { AssignClientDialog } from "@/components/AssignClientDialog";
import { UnfinishedDraftsSection } from "@/components/UnfinishedDraftsSection";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Plus, Search, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useHideMoney } from "@/hooks/use-hide-money";
import type { TopProductByCategory } from "@/components/CategoryProductsDialog";

// Prompt 6, punto 8: reemplaza el filtro viejo, que filtraba por `sale.status` — ese campo ya
// solo vale "pendiente"/"cancelada" (el pago y la entrega se separaron en sus propios
// conceptos, ver SaleCard/SaleDetailDialog). "Pendientes"/"Entregados"/"Pagados" ya no
// significaban nada real.
const statusFilters = [
  { value: "todas", label: "Todas" },
  { value: "te_deben", label: "Te deben" },
  { value: "pendientes_entrega", label: "Pendientes de entrega" },
  { value: "cobradas", label: "Cobradas" },
  { value: "canceladas", label: "Canceladas" },
];

export default function Ventas() {
  const { format } = useHideMoney();
  const cart = useSaleCart();
  const { isOpen: isSaleDialogOpen, openCreateSale, openEditSale } = useSaleDialog();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todas");
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [assigningClientSale, setAssigningClientSale] = useState<Sale | null>(null);

  // Si venimos de "Ir a Ventas" desde Productos con un carrito ya armado, abrir el diálogo
  // de venta nueva automáticamente en vez de dejar el carrito perdido en un botón sin apretar.
  // `clearCartOnClose: true` porque esta apertura (y la del botón "Nueva Venta" de abajo) están
  // ligadas al carrito compartido — al cerrar sin editar, se vacía (ver use-sale-dialog.tsx).
  // El diálogo compartido vive en AppShell y persiste al navegar — si ya está abierto (otra
  // sesión de venta en curso desde otra pantalla), nunca se la pisa.
  useEffect(() => {
    if (cart.lines.length > 0 && !isSaleDialogOpen) {
      openCreateSale({ initialLines: cart.lines, clearCartOnClose: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: sales = [], isError: errorSales } = useQuery<Sale[]>({ queryKey: ["/api/sales"] });
  const { data: topProducts = [], isError: errorTopProducts } = useQuery<TopProductByCategory[]>({
    queryKey: ["/api/sales/top-products", "top5"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/sales/top-products?limit=5");
      return res.json();
    },
  });

  // "/api/products" (para la venta nueva/editar) ya no se consulta en esta página — su propio
  // aviso de error vive en use-sale-dialog.tsx, que es quien lo consulta ahora.
  const hasLoadError = errorSales || errorTopProducts;

  const filteredSales = sales.filter((s) => {
    const matchesSearch = s.clientName.toLowerCase().includes(search.toLowerCase());
    let matchesStatus = true;
    if (statusFilter === "canceladas") matchesStatus = s.status === "cancelada";
    else if (statusFilter === "te_deben") matchesStatus = s.status !== "cancelada" && s.paymentStatus === "te_debe";
    else if (statusFilter === "cobradas") matchesStatus = s.status !== "cancelada" && s.paymentStatus === "cobrada";
    else if (statusFilter === "pendientes_entrega") matchesStatus = s.status !== "cancelada" && s.deliveryStatus === "pendiente_entrega";
    return matchesSearch && matchesStatus;
  });

  // Etapa I-B.7-D-B: excluye canceladas, igual que TODOS los endpoints de /api/reports/*
  // (ver server/storage.ts, `ne(sales.status, "cancelada")`) — antes de este fix, esta tarjeta
  // sumaba ventas canceladas mientras Reportes no, dando números distintos para el mismo
  // período en dos pantallas del mismo sistema (hallazgo I-B.7-D-A [F2]).
  const nonCancelledSales = sales.filter((s) => s.status !== "cancelada");
  const totalSales = nonCancelledSales.reduce((sum, s) => sum + s.total, 0);
  const totalProfit = nonCancelledSales.reduce((sum, s) => sum + s.profit, 0);
  // Prompt 6: "pendientes" (sale.status) ya no distingue nada — todas las no canceladas valen
  // "pendiente" ahora. Lo que importa mostrar es cuántas ventas todavía deben plata.
  const owingCount = nonCancelledSales.filter((s) => s.paymentStatus === "te_debe").length;

  return (
    <div className="p-6 space-y-6" data-testid="page-ventas">
      <UnfinishedDraftsSection
        type="sale"
        title="Ventas sin terminar"
        onResume={(draft) => openCreateSale({ draftToResume: draft, clearCartOnClose: true })}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Ventas</h1>
          <p className="text-muted-foreground">
            {errorSales
              ? "No pudimos calcular tus totales"
              : `${sales.length} venta${sales.length !== 1 ? "s" : ""} registrada${sales.length !== 1 ? "s" : ""} · ${owingCount} te debe${owingCount !== 1 ? "n" : ""}`}
          </p>
        </div>
        <Button
          onClick={() => openCreateSale({ initialLines: cart.lines, clearCartOnClose: true })}
          data-testid="button-add-sale"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nueva Venta
        </Button>
      </div>

      {hasLoadError && (
        <ErrorBlock message="No pudimos cargar parte de tu información de ventas. Tus datos siguen intactos — probá recargar la página." />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Ventas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {errorSales ? (
              <p className="text-sm text-destructive">No se pudo calcular</p>
            ) : (
              <p className="text-2xl font-bold tabular-nums">{format(totalSales)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ganancia Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            {errorSales ? (
              <p className="text-sm text-destructive">No se pudo calcular</p>
            ) : (
              <p className="text-2xl font-bold text-green-600 dark:text-green-400 tabular-nums">
                {format(totalProfit)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card data-testid="card-top-products">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Productos Más Vendidos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {errorTopProducts ? (
              <p className="text-sm text-destructive">No se pudo cargar</p>
            ) : topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay ventas registradas</p>
            ) : (
              <ol className="space-y-1.5">
                {topProducts.map((p, i) => (
                  <li
                    key={p.productId ?? p.productName}
                    className="flex items-center justify-between gap-2 text-sm"
                    data-testid={`top-product-row-${i}`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                      <span className="truncate">{p.productName}</span>
                    </span>
                    <span className="text-right shrink-0 tabular-nums text-xs text-muted-foreground">
                      {p.quantitySold}u · {format(p.totalSales)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por clienta..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-sales"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-status-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            {statusFilters.map((status) => (
              <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!errorSales && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSales.map((sale) => (
              <SaleCard
                key={sale.id}
                sale={sale}
                onClick={(s) => setSelectedSaleId(s.id)}
                onAssignClient={(s) => setAssigningClientSale(s)}
              />
            ))}
          </div>

          {filteredSales.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No se encontraron ventas
            </div>
          )}
        </>
      )}

      <SaleDetailDialog
        saleId={selectedSaleId}
        onOpenChange={(next) => !next && setSelectedSaleId(null)}
        onEdit={(sale) => {
          setSelectedSaleId(null);
          openEditSale(sale);
        }}
      />

      <AssignClientDialog
        sale={assigningClientSale}
        onOpenChange={(next) => !next && setAssigningClientSale(null)}
      />
    </div>
  );
}
