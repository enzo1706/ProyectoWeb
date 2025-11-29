import { ClientCard, type Client } from "../ClientCard";

const mockClient: Client = {
  id: "1",
  name: "María García López",
  phone: "+52 555 123 4567",
  email: "maria.garcia@email.com",
  category: "vip",
  totalPurchases: 2450.00,
  lastPurchase: "15 Nov 2025",
  birthday: "1990-03-15",
};

export default function ClientCardExample() {
  return (
    <ClientCard
      client={mockClient}
      onClick={(c) => console.log("Selected client:", c.name)}
    />
  );
}
