import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Phone, Mail, Calendar, ShoppingBag } from "lucide-react";

export interface Client {
  id: string;
  name: string;
  phone: string;
  email: string;
  birthday?: string;
  address?: string;
  category: "nueva" | "frecuente" | "vip" | "inactiva";
  totalPurchases: number;
  lastPurchase?: string;
  notes?: string;
}

interface ClientCardProps {
  client: Client;
  onClick?: (client: Client) => void;
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

export function ClientCard({ client, onClick }: ClientCardProps) {
  const initials = client.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Card
      className="hover-elevate cursor-pointer"
      onClick={() => onClick?.(client)}
      data-testid={`card-client-${client.id}`}
    >
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12 border border-border">
            <AvatarFallback className="bg-primary/10 text-primary font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-medium truncate" data-testid={`text-client-name-${client.id}`}>
                {client.name}
              </h3>
              <Badge className={categoryColors[client.category]} data-testid={`badge-category-${client.id}`}>
                {categoryLabels[client.category]}
              </Badge>
            </div>
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone className="h-3 w-3" />
                <span>{client.phone}</span>
              </div>
              {client.email && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  <span className="truncate">{client.email}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t flex items-center justify-between text-sm">
          <div className="flex items-center gap-1 text-muted-foreground">
            <ShoppingBag className="h-3 w-3" />
            <span>${client.totalPurchases.toFixed(2)}</span>
          </div>
          {client.lastPurchase && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{client.lastPurchase}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
