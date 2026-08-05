import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
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
  AreaChart,
  Area,
} from "recharts";

// todo: remove mock functionality
const monthlyData = [
  { month: "Ene", ventas: 2100, ganancia: 945 },
  { month: "Feb", ventas: 2400, ganancia: 1080 },
  { month: "Mar", ventas: 2800, ganancia: 1260 },
  { month: "Abr", ventas: 3100, ganancia: 1395 },
  { month: "May", ventas: 2900, ganancia: 1305 },
  { month: "Jun", ventas: 3400, ganancia: 1530 },
  { month: "Jul", ventas: 3800, ganancia: 1710 },
  { month: "Ago", ventas: 3500, ganancia: 1575 },
  { month: "Sep", ventas: 4000, ganancia: 1800 },
  { month: "Oct", ventas: 4200, ganancia: 1890 },
  { month: "Nov", ventas: 4500, ganancia: 2025 },
];

// todo: remove mock functionality
const categoryData = [
  { name: "Cuidado de la Piel", value: 45, color: "hsl(330, 81%, 45%)" },
  { name: "Maquillaje", value: 32, color: "hsl(280, 65%, 40%)" },
  { name: "Fragancias", value: 15, color: "hsl(200, 70%, 35%)" },
  { name: "Accesorios", value: 8, color: "hsl(25, 75%, 40%)" },
];

// todo: remove mock functionality
const topProducts = [
  { name: "TimeWise Repair Serum", ventas: 42, revenue: 3570 },
  { name: "Base CC Cream SPF 15", ventas: 38, revenue: 1330 },
  { name: "Labial Gel Semi-Shine", ventas: 35, revenue: 630 },
  { name: "Gel Limpiador 3D", ventas: 28, revenue: 728 },
  { name: "Máscara Lash Love", ventas: 24, revenue: 384 },
];

// todo: remove mock functionality
const topClients = [
  { name: "Guadalupe Torres", compras: 12, total: 3200 },
  { name: "María García López", compras: 10, total: 2450 },
  { name: "Ana Martínez Ruiz", compras: 8, total: 1280 },
  { name: "Laura Hernández", compras: 6, total: 890 },
  { name: "Carmen Flores", compras: 5, total: 720 },
];

// todo: remove mock functionality
const clientCategoryData = [
  { category: "VIP", count: 5, color: "hsl(280, 65%, 40%)" },
  { category: "Frecuentes", count: 12, color: "hsl(140, 60%, 40%)" },
  { category: "Nuevas", count: 8, color: "hsl(200, 70%, 45%)" },
  { category: "Inactivas", count: 7, color: "hsl(0, 0%, 60%)" },
];

export default function Reportes() {
  const [period, setPeriod] = useState("year");

  const totalSales = monthlyData.reduce((sum, m) => sum + m.ventas, 0);
  const totalProfit = monthlyData.reduce((sum, m) => sum + m.ganancia, 0);
  const avgMonthly = totalSales / monthlyData.length;

  return (
    <div className="p-6 space-y-6" data-testid="page-reportes">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Reportes</h1>
          <p className="text-muted-foreground">Análisis detallado de tu negocio</p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">Este Mes</SelectItem>
            <SelectItem value="quarter">Trimestre</SelectItem>
            <SelectItem value="year">Este Año</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ventas Totales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">${totalSales.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">2025</p>
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
              ${totalProfit.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">45% margen</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Promedio Mensual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">${avgMonthly.toFixed(0)}</p>
            <p className="text-xs text-muted-foreground">ventas/mes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Clientas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">32</p>
            <p className="text-xs text-muted-foreground">5 VIP</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-sales-trend">
          <CardHeader>
            <CardTitle className="text-lg">Tendencia de Ventas y Ganancias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData}>
                  <defs>
                    <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(140, 60%, 40%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(140, 60%, 40%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                    }}
                    formatter={(value: number, name: string) => [`$${value}`, name === "ventas" ? "Ventas" : "Ganancia"]}
                  />
                  <Area type="monotone" dataKey="ventas" stroke="hsl(var(--primary))" fill="url(#salesGradient)" strokeWidth={2} />
                  <Area type="monotone" dataKey="ganancia" stroke="hsl(140, 60%, 40%)" fill="url(#profitGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-category-breakdown">
          <CardHeader>
            <CardTitle className="text-lg">Ventas por Categoría</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
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
            <div className="flex flex-wrap justify-center gap-4 mt-2">
              {categoryData.map((cat) => (
                <div key={cat.name} className="flex items-center gap-2 text-sm">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="text-muted-foreground">{cat.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-top-products">
          <CardHeader>
            <CardTitle className="text-lg">Productos Más Vendidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topProducts.map((product, i) => (
                <div key={product.name} className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{product.name}</p>
                    <p className="text-sm text-muted-foreground">{product.ventas} unidades</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums">${product.revenue.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-top-clients">
          <CardHeader>
            <CardTitle className="text-lg">Mejores Clientas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topClients.map((client, i) => (
                <div key={client.name} className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{client.name}</p>
                    <p className="text-sm text-muted-foreground">{client.compras} compras</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums">${client.total.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-client-distribution">
        <CardHeader>
          <CardTitle className="text-lg">Distribución de Clientas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clientCategoryData} layout="vertical">
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis
                  dataKey="category"
                  type="category"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  width={80}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                  }}
                  formatter={(value: number) => [`${value} clientas`, ""]}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {clientCategoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
