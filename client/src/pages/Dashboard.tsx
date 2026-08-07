import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/MetricCard";
import { AppointmentCard, typeLabels } from "@/components/AppointmentCard";
import { LowStockDialog } from "@/components/LowStockDialog";
import { AppointmentDetailDialog } from "@/components/AppointmentDetailDialog";
import { TopClientsDialog, type TopClient } from "@/components/TopClientsDialog";
import { CategoryProductsDialog, type TopProductByCategory } from "@/components/CategoryProductsDialog";
import type { Product, Appointment } from "@shared/schema";
import { chartTooltipStyle } from "@/lib/chart-theme";
import { parseLocalDate } from "@/lib/date";
import {
  DollarSign,
  Package,
  Users,
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

function formatAppointmentShort(appointment: Appointment): string {
  const date = parseLocalDate(appointment.date);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm} - ${appointment.time}`;
}

export default function Dashboard() {
  const [lowStockOpen, setLowStockOpen] = useState(false);
  const [appointmentDetailOpen, setAppointmentDetailOpen] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [topClientsOpen, setTopClientsOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const { data: lowStockProducts = [] } = useQuery<Product[]>({
    queryKey: ["/api/products/low-stock"],
  });

  const { data: upcomingAppointments = [] } = useQuery<Appointment[]>({
    queryKey: ["/api/appointments/upcoming"],
  });

  const { data: topClients = [] } = useQuery<TopClient[]>({
    queryKey: ["/api/clients/top"],
  });

  const { data: categoryProducts = [] } = useQuery<TopProductByCategory[]>({
    queryKey: ["/api/sales/top-products", selectedCategory],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/sales/top-products?category=${encodeURIComponent(selectedCategory ?? "")}`);
      return res.json();
    },
    enabled: categoryDialogOpen && !!selectedCategory,
  });

  const nextAppointment = upcomingAppointments[0];

  // Derivado de la lista en vivo (no un snapshot) — así, si el estado cambia desde el propio
  // diálogo, el badge se actualiza y la cita desaparece de la lista sin recargar la página.
  const detailAppointment = upcomingAppointments.find((a) => a.id === selectedAppointmentId) ?? null;

  const openAppointmentDetail = (appointment: Appointment) => {
    setSelectedAppointmentId(appointment.id);
    setAppointmentDetailOpen(true);
  };

  const handleCategoryClick = (categoryName: string) => {
    setSelectedCategory(categoryName);
    setCategoryDialogOpen(true);
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-dashboard">
      <div>
        <h1 className="text-3xl font-bold">Inicio</h1>
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
          title="Productos con bajo Stock"
          value={lowStockProducts.length}
          icon={Package}
          onClick={() => setLowStockOpen(true)}
        />
        <MetricCard
          title="Próximas Citas"
          value={nextAppointment ? formatAppointmentShort(nextAppointment) : "No hay próximas citas"}
          subtitle={nextAppointment ? typeLabels[nextAppointment.type] ?? nextAppointment.type : undefined}
          icon={Calendar}
          onClick={nextAppointment ? () => openAppointmentDetail(nextAppointment) : undefined}
        />
        <MetricCard
          title="Mejores Clientes"
          value={topClients.length}
          icon={Users}
          onClick={() => setTopClientsOpen(true)}
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
                    contentStyle={chartTooltipStyle}
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
                    cursor="pointer"
                    onClick={(entry) => handleCategoryClick(entry.name)}
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(value: number) => [`${value}%`, ""]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap justify-center gap-2.5 mt-2">
              {categoryData.map((cat) => (
                <button
                  key={cat.name}
                  type="button"
                  onClick={() => handleCategoryClick(cat.name)}
                  className="flex items-center gap-1.5 text-xs hover-elevate active-elevate-2 rounded-md px-2.5 py-2"
                >
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                  <span className="text-muted-foreground">{cat.name}</span>
                </button>
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
                    tickFormatter={(value: string) => (value.length > 16 ? `${value.slice(0, 15)}…` : value)}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
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
            {upcomingAppointments.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No hay próximas citas</p>
            ) : (
              upcomingAppointments.slice(0, 3).map((apt) => (
                <AppointmentCard
                  key={apt.id}
                  appointment={apt}
                  onClick={() => openAppointmentDetail(apt)}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <LowStockDialog open={lowStockOpen} onOpenChange={setLowStockOpen} products={lowStockProducts} />
      <AppointmentDetailDialog
        open={appointmentDetailOpen}
        onOpenChange={(next) => {
          setAppointmentDetailOpen(next);
          if (!next) setSelectedAppointmentId(null);
        }}
        appointment={detailAppointment}
      />
      <TopClientsDialog open={topClientsOpen} onOpenChange={setTopClientsOpen} clients={topClients} />
      <CategoryProductsDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        category={selectedCategory}
        products={categoryProducts}
      />
    </div>
  );
}
