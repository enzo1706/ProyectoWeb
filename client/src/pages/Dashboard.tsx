import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/MetricCard";
import { StockAlert } from "@/components/StockAlert";
import { AppointmentCard, type Appointment } from "@/components/AppointmentCard";
import { SaleCard, type Sale } from "@/components/SaleCard";
import type { Product } from "@/components/ProductCard";
import {
  DollarSign,
  Package,
  Users,
  TrendingUp,
  Calendar,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// todo: remove mock functionality
const mockProducts: Product[] = [
  { id: "1", name: "TimeWise Repair Serum", sku: "MK-TW-001", category: "Cuidado de la Piel", price: 85, cost: 42.5, stock: 0, minStock: 3 },
  { id: "2", name: "Labial Ultimate", sku: "MK-LU-002", category: "Maquillaje", price: 22, cost: 11, stock: 2, minStock: 5 },
  { id: "3", name: "Base CC Cream", sku: "MK-CC-003", category: "Maquillaje", price: 35, cost: 17.5, stock: 1, minStock: 3 },
];

// todo: remove mock functionality
const mockAppointments: Appointment[] = [
  { id: "1", clientName: "María García", clientId: "c1", date: "2025-11-29", time: "10:00 AM", type: "demostracion", location: "Colonia Roma" },
  { id: "2", clientName: "Ana Martínez", clientId: "c2", date: "2025-11-29", time: "3:00 PM", type: "entrega" },
  { id: "3", clientName: "Laura Hernández", clientId: "c3", date: "2025-11-30", time: "11:00 AM", type: "seguimiento" },
];

// todo: remove mock functionality
const mockRecentSales: Sale[] = [
  { id: "1", clientId: "c1", clientName: "Patricia Ruiz", date: "28 Nov", items: [{ productId: "p1", productName: "Serum", quantity: 1, price: 65 }], total: 165, profit: 72, status: "pagado" },
  { id: "2", clientId: "c2", clientName: "Carmen Flores", date: "27 Nov", items: [{ productId: "p2", productName: "Labial", quantity: 2, price: 22 }], total: 88, profit: 44, status: "entregado" },
];

// todo: remove mock functionality
const monthlySalesData = [
  { month: "Jun", ventas: 2400 },
  { month: "Jul", ventas: 3200 },
  { month: "Ago", ventas: 2800 },
  { month: "Sep", ventas: 3600 },
  { month: "Oct", ventas: 4100 },
  { month: "Nov", ventas: 4250 },
];

// todo: remove mock functionality
const categoryData = [
  { name: "Cuidado Piel", value: 45, color: "hsl(330, 81%, 45%)" },
  { name: "Maquillaje", value: 35, color: "hsl(280, 65%, 40%)" },
  { name: "Fragancias", value: 12, color: "hsl(200, 70%, 35%)" },
  { name: "Accesorios", value: 8, color: "hsl(25, 75%, 40%)" },
];

// todo: remove mock functionality
const topProductsData = [
  { name: "TimeWise Serum", ventas: 24 },
  { name: "Base CC Cream", ventas: 18 },
  { name: "Labial Ultimate", ventas: 15 },
  { name: "Gel Limpiador", ventas: 12 },
];

export default function Dashboard() {
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);

  return (
    <div className="p-6 space-y-6" data-testid="page-dashboard">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Resumen de tu negocio Mary Kay</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Ventas del Mes"
          value="$4,250.00"
          icon={DollarSign}
          trend={{ value: 12.5, isPositive: true }}
        />
        <MetricCard
          title="Productos en Stock"
          value="48"
          icon={Package}
          subtitle="3 con stock bajo"
        />
        <MetricCard
          title="Total Clientas"
          value="32"
          icon={Users}
          trend={{ value: 8, isPositive: true }}
        />
        <MetricCard
          title="Ganancia del Mes"
          value="$1,890.00"
          icon={TrendingUp}
          trend={{ value: 15.2, isPositive: true }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2" data-testid="card-sales-chart">
          <CardHeader>
            <CardTitle className="text-lg">Ventas Mensuales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlySalesData}>
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                    }}
                    formatter={(value: number) => [`$${value}`, "Ventas"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="ventas"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-category-chart">
          <CardHeader>
            <CardTitle className="text-lg">Ventas por Categoría</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                    }}
                    formatter={(value: number) => [`${value}%`, ""]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap justify-center gap-3 mt-2">
              {categoryData.map((cat) => (
                <div key={cat.name} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="text-muted-foreground">{cat.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card data-testid="card-top-products">
          <CardHeader>
            <CardTitle className="text-lg">Productos Más Vendidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProductsData} layout="vertical">
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    width={100}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                    }}
                  />
                  <Bar dataKey="ventas" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-upcoming-appointments">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Próximas Citas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {mockAppointments.slice(0, 3).map((apt) => (
              <AppointmentCard
                key={apt.id}
                appointment={apt}
                onClick={setSelectedAppointment}
              />
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <StockAlert products={mockProducts} />
          <Card data-testid="card-recent-sales">
            <CardHeader>
              <CardTitle className="text-lg">Ventas Recientes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {mockRecentSales.map((sale) => (
                <SaleCard key={sale.id} sale={sale} />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
