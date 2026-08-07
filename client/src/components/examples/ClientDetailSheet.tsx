import { useState } from "react";
import { ClientDetailSheet } from "../ClientDetailSheet";
import { Button } from "@/components/ui/button";
import type { Client } from "../ClientCard";

const mockClient: Client = {
  id: 1,
  consultantId: 1,
  name: "María García López",
  phone: "5551234567",
  email: "maria.garcia@email.com",
  totalPurchases: 2450.00,
  lastPurchase: "15 Nov 2025",
  birthday: "1990-03-15",
  address: "Col. Roma Norte, CDMX",
  notes: "Prefiere productos de cuidado de la piel. Interesada en la línea TimeWise.",
};

export default function ClientDetailSheetExample() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Ver Detalle</Button>
      <ClientDetailSheet
        open={open}
        onOpenChange={setOpen}
        client={mockClient}
        onEdit={(client) => console.log("Editar clienta:", client.name)}
        onNewSale={(client) => console.log("Nueva venta para:", client.name)}
      />
    </>
  );
}
