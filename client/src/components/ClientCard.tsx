import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Phone, Mail, Calendar, ShoppingBag } from "lucide-react";
import { useHideMoney } from "@/hooks/use-hide-money";
import type { Client as BaseClient } from "@shared/schema";

export interface Client extends BaseClient {
  totalPurchases: number;
  lastPurchase?: string | null;
  pendingBalance?: number;
}

interface ClientCardProps {
  client: Client;
  onClick?: (client: Client) => void;
}

export function ClientCard({ client, onClick }: ClientCardProps) {
  const { format } = useHideMoney();
  const displayName = client.name?.trim() || client.phone;
  const initials = displayName
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
                {displayName}
              </h3>
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
            <span>{format(client.totalPurchases)}</span>
          </div>
          {client.lastPurchase && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{client.lastPurchase}</span>
            </div>
          )}
        </div>
        {!!client.pendingBalance && (
          <div
            className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400"
            data-testid={`text-pending-balance-${client.id}`}
          >
            Saldo pendiente: {format(client.pendingBalance)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
