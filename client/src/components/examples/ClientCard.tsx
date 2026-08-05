import { ClientCard, type Client } from "../ClientCard";

const mockClient: Client = {
  id: 1,
  name: "María García López",
  phone: "5551234567",
  email: "maria.garcia@email.com",
  totalPurchases: 2450.00,
  lastPurchase: "15 Nov 2025",
  birthday: "1990-03-15",
  address: null,
  notes: null,
};

export default function ClientCardExample() {
  return (
    <ClientCard
      client={mockClient}
      onClick={(c) => console.log("Selected client:", c.name)}
    />
  );
}
