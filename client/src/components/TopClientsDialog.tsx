import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, ShoppingBag, Package } from "lucide-react";
import { formatPrice } from "@/lib/currency";

export interface TopClient {
  clientId: number;
  clientName: string;
  purchaseCount: number;
  totalAmount: number;
  productCount: number;
}

interface TopClientsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: TopClient[];
}

export function TopClientsDialog({ open, onOpenChange, clients }: TopClientsDialogProps) {
  const initials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-top-clients">
        <DialogHeader>
          <DialogTitle>Mejores Clientes</DialogTitle>
        </DialogHeader>

        {clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Users className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Todavía no hay clientas destacadas este mes</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {clients.map((client) => (
              <div
                key={client.clientId}
                className="flex items-center gap-3 rounded-lg border p-3"
                data-testid={`row-top-client-${client.clientId}`}
              >
                <Avatar className="h-10 w-10 border border-border shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary font-medium">
                    {initials(client.clientName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{client.clientName}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <ShoppingBag className="h-3 w-3" />
                      {client.purchaseCount} compra{client.purchaseCount !== 1 ? "s" : ""}
                    </span>
                    <span className="flex items-center gap-1">
                      <Package className="h-3 w-3" />
                      {client.productCount} producto{client.productCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <p className="text-lg font-bold tabular-nums shrink-0">{formatPrice(client.totalAmount)}</p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
