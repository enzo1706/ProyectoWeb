import { SaleCard, type Sale } from "../SaleCard";

const mockSale: Sale = {
  id: "1",
  clientId: "c1",
  clientName: "Laura Hernández",
  date: "28 Nov 2025",
  items: [
    { productId: "p1", productName: "TimeWise Serum", quantity: 1, price: 65.00 },
    { productId: "p2", productName: "Labial Gel Semi-Shine", quantity: 2, price: 18.00 },
  ],
  total: 101.00,
  profit: 45.50,
  status: "pagado",
};

export default function SaleCardExample() {
  return (
    <SaleCard
      sale={mockSale}
      onClick={(s) => console.log("Selected sale:", s.id)}
    />
  );
}
