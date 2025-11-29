import { ProductCard, type Product } from "../ProductCard";

const mockProduct: Product = {
  id: "1",
  name: "TimeWise Repair Revealing Radiance",
  sku: "MK-TW-001",
  category: "Cuidado de la Piel",
  price: 85.00,
  cost: 42.50,
  stock: 5,
  minStock: 3,
};

export default function ProductCardExample() {
  return (
    <ProductCard
      product={mockProduct}
      onEdit={(p) => console.log("Edit product:", p.name)}
    />
  );
}
