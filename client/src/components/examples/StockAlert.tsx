import { StockAlert } from "../StockAlert";
import type { Product } from "../ProductCard";

const mockProducts: Product[] = [
  { id: "1", name: "TimeWise Repair", sku: "MK-001", category: "Skincare", price: 85, cost: 42.5, stock: 0, minStock: 3 },
  { id: "2", name: "Labial Ultimate", sku: "MK-002", category: "Maquillaje", price: 22, cost: 11, stock: 2, minStock: 5 },
  { id: "3", name: "Base Matte", sku: "MK-003", category: "Maquillaje", price: 35, cost: 17.5, stock: 1, minStock: 3 },
];

export default function StockAlertExample() {
  return <StockAlert products={mockProducts} />;
}
