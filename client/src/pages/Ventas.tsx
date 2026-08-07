import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SaleCard, type Sale, type SaleDetails } from "@/components/SaleCard";
import { NewSaleDialog } from "@/components/NewSaleDialog";
import { SaleDetailDialog } from "@/components/SaleDetailDialog";
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
import { formatPrice } from "@/lib/currency";
import type { Product } from "@shared/schema";
import type { TopProductByCategory } from "@/components/CategoryProductsDialog";

const statusFilters = [
  { value: "todos", label: "Todos" },
  { value: "pendiente", label: "Pendientes" },
  { value: "entregado", label: "Entregados" },
  { value: "pagado", label: "Pagados" },
  { value: "cancelada", label: "Canceladas" },
];

export default function Ventas() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [editingSale, setEditingSale] = useState<SaleDetails | null>(null);

  const { data: sales = [] } = useQuery<Sale[]>({ queryKey: ["/api/sales"] });
  const { data: products = [] } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: topProducts = [] } = useQuery<TopProductByCategory[]>({
    queryKey: ["/api/sales/top-products", "top5"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/sales/top-products?limit=5");
      return res.json();
    },
  });

  const filteredSales = sales.filter((s) => {
    const matchesSearch = s.clientName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "todos" || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  const totalProfit = sales.reduce((sum, s) => sum + s.profit, 0);
  const pendingCount = sales.filter((s) => s.status === "pendiente").length;

  return (
    <div className="p-6 space-y-6" data-testid="page-ventas">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Ventas</h1>
          <p className="text-muted-foreground">
            {sales.length} ventas registradas | {pendingCount} pendientes
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} data-testid="button-add-sale">
          <Plus className="h-4 w-4 mr-2" />
          Nueva Venta
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Ventas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{formatPrice(totalSales)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ganancia Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400 tabular-nums">
              {formatPrice(totalProfit)}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-top-products">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Productos Más Vendidos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
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
                      {p.quantitySold}u · {formatPrice(p.totalSales)}
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSales.map((sale) => (
          <SaleCard key={sale.id} sale={sale} onClick={(s) => setSelectedSaleId(s.id)} />
        ))}
      </div>

      {filteredSales.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No se encontraron ventas
        </div>
      )}

      <NewSaleDialog
        open={dialogOpen || editingSale !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDialogOpen(false);
            setEditingSale(null);
          }
        }}
        products={products}
        existingSale={editingSale}
      />

      <SaleDetailDialog
        saleId={selectedSaleId}
        onOpenChange={(next) => !next && setSelectedSaleId(null)}
        onEdit={(sale) => {
          setSelectedSaleId(null);
          setEditingSale(sale);
        }}
      />
    </div>
  );
}
