import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SaleCard, type Sale } from "@/components/SaleCard";
import { SaleDialog } from "@/components/SaleDialog";
import { Plus, Search, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// todo: remove mock functionality
const initialSales: Sale[] = [
  { id: "1", clientId: "c1", clientName: "María García López", date: "28 Nov 2025", items: [{ productId: "p1", productName: "TimeWise Repair Serum", quantity: 1, price: 85.00 }, { productId: "p2", productName: "Gel Limpiador 3D", quantity: 1, price: 26.00 }], total: 111.00, profit: 55.50, status: "pagado" },
  { id: "2", clientId: "c2", clientName: "Ana Martínez Ruiz", date: "27 Nov 2025", items: [{ productId: "p3", productName: "Base CC Cream SPF 15", quantity: 1, price: 35.00 }], total: 35.00, profit: 17.50, status: "entregado" },
  { id: "3", clientId: "c3", clientName: "Laura Hernández", date: "26 Nov 2025", items: [{ productId: "p4", productName: "Labial Gel Semi-Shine Berry", quantity: 2, price: 18.00 }, { productId: "p5", productName: "Máscara Lash Love", quantity: 1, price: 16.00 }], total: 52.00, profit: 26.00, status: "pendiente" },
  { id: "4", clientId: "c4", clientName: "Patricia Ruiz Sánchez", date: "25 Nov 2025", items: [{ productId: "p6", productName: "Fragancia Journey", quantity: 1, price: 45.00 }], total: 45.00, profit: 22.50, status: "pagado" },
  { id: "5", clientId: "c5", clientName: "Carmen Flores", date: "24 Nov 2025", items: [{ productId: "p1", productName: "TimeWise Repair Serum", quantity: 1, price: 85.00 }], total: 85.00, profit: 42.50, status: "pagado" },
  { id: "6", clientId: "c7", clientName: "Guadalupe Torres", date: "23 Nov 2025", items: [{ productId: "p2", productName: "Set Brochas Esenciales", quantity: 1, price: 55.00 }, { productId: "p3", productName: "Base CC Cream SPF 15", quantity: 2, price: 35.00 }], total: 125.00, profit: 62.50, status: "pagado" },
];

const statusFilters = [
  { value: "todos", label: "Todos" },
  { value: "pendiente", label: "Pendientes" },
  { value: "entregado", label: "Entregados" },
  { value: "pagado", label: "Pagados" },
];

export default function Ventas() {
  const [sales, setSales] = useState<Sale[]>(initialSales);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filteredSales = sales.filter((s) => {
    const matchesSearch = s.clientName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "todos" || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  const totalProfit = sales.reduce((sum, s) => sum + s.profit, 0);
  const pendingCount = sales.filter(s => s.status === "pendiente").length;

  const handleNewSale = (sale: Omit<Sale, "id">) => {
    const newSale: Sale = {
      ...sale,
      id: `s${Date.now()}`,
    };
    setSales([newSale, ...sales]);
    setDialogOpen(false);
  };

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
            <p className="text-2xl font-bold tabular-nums">${totalSales.toFixed(2)}</p>
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
              ${totalProfit.toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Margen Promedio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">
              {((totalProfit / totalSales) * 100).toFixed(1)}%
            </p>
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
          <SaleCard key={sale.id} sale={sale} />
        ))}
      </div>

      {filteredSales.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No se encontraron ventas
        </div>
      )}

      <SaleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleNewSale}
      />
    </div>
  );
}
