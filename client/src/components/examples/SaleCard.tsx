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
  shippingCharged: null,
  shippingCost: null,
  ingresosBrutos: null,
  grossIncomeTaxPercentTenths: null,
  total: 10100,
  profit: 4550,
  paymentMethod: "efectivo",
  installmentsCount: 1,
  installmentFrequency: null,
  status: "pendiente",
  deliveryStatus: "entregada",
  notes: null,
  clientRequestId: null,
  itemCount: 3,
  hasEstimatedCost: false,
  paymentStatus: "te_debe",
  pendingAmount: 10100,
  nextDueDate: "2025-12-05",
};

export default function SaleCardExample() {
  return (
    <SaleCard
      sale={mockSale}
      onClick={(s) => console.log("Selected sale:", s.id)}
    />
  );
}
