import { SaleCard, type Sale } from "../SaleCard";

const mockSale: Sale = {
  id: 1,
  consultantId: 1,
  clientId: 1,
  clientName: "Laura Hernández",
  date: "2025-11-28",
  subtotal: 10100,
  orderDiscountType: null,
  orderDiscountValue: null,
  orderSurchargeType: null,
  orderSurchargeValue: null,
  shippingCost: null,
  total: 10100,
  profit: 4550,
  paymentMethod: "efectivo",
  installmentsCount: 1,
  installmentFrequency: null,
  status: "pagado",
  notes: null,
  itemCount: 3,
};

export default function SaleCardExample() {
  return (
    <SaleCard
      sale={mockSale}
      onClick={(s) => console.log("Selected sale:", s.id)}
    />
  );
}
