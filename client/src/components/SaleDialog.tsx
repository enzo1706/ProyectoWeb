import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import type { Sale, SaleItem } from "./SaleCard";

interface SaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (sale: Omit<Sale, "id">) => void;
}

// todo: remove mock functionality
const mockClients = [
  { id: "c1", name: "María García López" },
  { id: "c2", name: "Ana Martínez Ruiz" },
  { id: "c3", name: "Laura Hernández" },
  { id: "c4", name: "Patricia Ruiz Sánchez" },
  { id: "c5", name: "Carmen Flores" },
];

// todo: remove mock functionality
const mockProducts = [
  { id: "p1", name: "TimeWise Repair Serum", price: 85.00, cost: 42.50 },
  { id: "p2", name: "Gel Limpiador 3D", price: 26.00, cost: 13.00 },
  { id: "p3", name: "Base CC Cream SPF 15", price: 35.00, cost: 17.50 },
  { id: "p4", name: "Labial Gel Semi-Shine", price: 18.00, cost: 9.00 },
  { id: "p5", name: "Máscara Lash Love", price: 16.00, cost: 8.00 },
  { id: "p6", name: "Fragancia Journey", price: 45.00, cost: 22.50 },
];

export function SaleDialog({ open, onOpenChange, onSave }: SaleDialogProps) {
  const [clientId, setClientId] = useState("");
  const [items, setItems] = useState<(SaleItem & { cost: number })[]>([]);
  const [status, setStatus] = useState<Sale["status"]>("pendiente");

  const addItem = () => {
    setItems([...items, { productId: "", productName: "", quantity: 1, price: 0, cost: 0 }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, productId: string) => {
    const product = mockProducts.find(p => p.id === productId);
    if (product) {
      const newItems = [...items];
      newItems[index] = {
        productId: product.id,
        productName: product.name,
        quantity: newItems[index].quantity,
        price: product.price,
        cost: product.cost,
      };
      setItems(newItems);
    }
  };

  const updateQuantity = (index: number, quantity: number) => {
    const newItems = [...items];
    newItems[index].quantity = quantity;
    setItems(newItems);
  };

  const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const profit = items.reduce((sum, item) => sum + ((item.price - item.cost) * item.quantity), 0);

  const handleSave = () => {
    const client = mockClients.find(c => c.id === clientId);
    if (!client || items.length === 0) return;

    const today = new Date();
    const dateStr = today.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

    onSave({
      clientId,
      clientName: client.name,
      date: dateStr,
      items: items.map(({ cost, ...item }) => item),
      total,
      profit,
      status,
    });

    setClientId("");
    setItems([]);
    setStatus("pendiente");
  };

  const isValid = clientId && items.length > 0 && items.every(i => i.productId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-sale">
        <DialogHeader>
          <DialogTitle>Nueva Venta</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Clienta</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="mt-1.5" data-testid="select-sale-client">
                <SelectValue placeholder="Seleccionar clienta" />
              </SelectTrigger>
              <SelectContent>
                {mockClients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Productos</Label>
              <Button type="button" variant="outline" size="sm" onClick={addItem} data-testid="button-add-item">
                <Plus className="h-3 w-3 mr-1" />
                Agregar
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={index} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Select value={item.productId} onValueChange={(v) => updateItem(index, v)}>
                      <SelectTrigger data-testid={`select-product-${index}`}>
                        <SelectValue placeholder="Producto" />
                      </SelectTrigger>
                      <SelectContent>
                        {mockProducts.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name} - ${product.price}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateQuantity(index, parseInt(e.target.value) || 1)}
                      data-testid={`input-quantity-${index}`}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(index)}
                    data-testid={`button-remove-item-${index}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Agrega productos a la venta
                </p>
              )}
            </div>
          </div>

          <div>
            <Label>Estado</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as Sale["status"])}>
              <SelectTrigger className="mt-1.5" data-testid="select-sale-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="entregado">Entregado</SelectItem>
                <SelectItem value="pagado">Pagado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {items.length > 0 && (
            <div className="pt-4 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span className="tabular-nums">${total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                <span>Ganancia</span>
                <span className="tabular-nums">+${profit.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>Total</span>
                <span className="tabular-nums">${total.toFixed(2)}</span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={!isValid} data-testid="button-save-sale">
              Registrar Venta
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
