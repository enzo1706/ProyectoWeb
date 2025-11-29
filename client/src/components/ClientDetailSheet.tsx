import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Phone, Mail, MapPin, Calendar, Edit, ShoppingCart, Gift } from "lucide-react";
import type { Client } from "./ClientCard";

interface ClientDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client | null;
  onEdit: (client: Client) => void;
}

const categoryColors: Record<Client["category"], string> = {
  nueva: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  frecuente: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  vip: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  inactiva: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
};

const categoryLabels: Record<Client["category"], string> = {
  nueva: "Nueva",
  frecuente: "Frecuente",
  vip: "VIP",
  inactiva: "Inactiva",
};

// todo: remove mock functionality
const mockPurchaseHistory = [
  { id: "1", date: "15 Nov 2025", products: ["TimeWise Serum", "Labial Berry"], total: 103.00 },
  { id: "2", date: "28 Oct 2025", products: ["Base CC Cream"], total: 35.00 },
  { id: "3", date: "10 Oct 2025", products: ["Gel Limpiador", "Crema de Día"], total: 78.00 },
];

export function ClientDetailSheet({ open, onOpenChange, client, onEdit }: ClientDetailSheetProps) {
  if (!client) return null;

  const initials = client.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const formatBirthday = (date?: string) => {
    if (!date) return null;
    const d = new Date(date);
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
  };

  return (
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
              <SheetTitle className="text-xl">{client.name}</SheetTitle>
              <Badge className={`mt-1 ${categoryColors[client.category]}`}>
                {categoryLabels[client.category]}
              </Badge>
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

        <div className="mt-6 grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold tabular-nums">${client.totalPurchases.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Total Compras</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold">{client.lastPurchase || "-"}</p>
              <p className="text-xs text-muted-foreground">Última Compra</p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 flex gap-2">
          <Button className="flex-1" onClick={() => onEdit(client)} data-testid="button-edit-client-detail">
            <Edit className="h-4 w-4 mr-2" />
            Editar
          </Button>
          <Button variant="outline" className="flex-1" data-testid="button-new-sale-client">
            <ShoppingCart className="h-4 w-4 mr-2" />
            Nueva Venta
          </Button>
        </div>

        <Tabs defaultValue="historial" className="mt-6">
          <TabsList className="w-full">
            <TabsTrigger value="historial" className="flex-1">Historial</TabsTrigger>
            <TabsTrigger value="citas" className="flex-1">Citas</TabsTrigger>
            <TabsTrigger value="notas" className="flex-1">Notas</TabsTrigger>
          </TabsList>
          <TabsContent value="historial" className="mt-4 space-y-3">
            {mockPurchaseHistory.map((purchase) => (
              <Card key={purchase.id}>
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>{purchase.date}</span>
                    </div>
                    <span className="font-medium">${purchase.total.toFixed(2)}</span>
                  </div>
                  <p className="text-sm mt-1">{purchase.products.join(", ")}</p>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
          <TabsContent value="citas" className="mt-4">
            <p className="text-center text-muted-foreground py-8">
              No hay citas programadas
            </p>
          </TabsContent>
          <TabsContent value="notas" className="mt-4">
            {client.notes ? (
              <Card>
                <CardContent className="py-4">
                  <p className="text-sm">{client.notes}</p>
                </CardContent>
              </Card>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Sin notas
              </p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
