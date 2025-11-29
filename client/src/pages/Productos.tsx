import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductCard, type Product } from "@/components/ProductCard";
import { ProductDialog } from "@/components/ProductDialog";
import { Plus, Search, Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// todo: remove mock functionality
const initialProducts: Product[] = [
  { id: "1", name: "TimeWise Repair Revealing Radiance", sku: "MK-TW-001", category: "Cuidado de la Piel", price: 85.00, cost: 42.50, stock: 8, minStock: 3 },
  { id: "2", name: "TimeWise Age Minimize 3D Day Cream", sku: "MK-TW-002", category: "Cuidado de la Piel", price: 52.00, cost: 26.00, stock: 12, minStock: 5 },
  { id: "3", name: "Gel Limpiador 3D", sku: "MK-TW-003", category: "Cuidado de la Piel", price: 26.00, cost: 13.00, stock: 15, minStock: 5 },
  { id: "4", name: "Labial Gel Semi-Shine Berry", sku: "MK-LB-001", category: "Maquillaje", price: 18.00, cost: 9.00, stock: 20, minStock: 8 },
  { id: "5", name: "Labial Gel Semi-Shine Pink", sku: "MK-LB-002", category: "Maquillaje", price: 18.00, cost: 9.00, stock: 2, minStock: 8 },
  { id: "6", name: "Base CC Cream SPF 15", sku: "MK-CC-001", category: "Maquillaje", price: 35.00, cost: 17.50, stock: 6, minStock: 4 },
  { id: "7", name: "Máscara Lash Love", sku: "MK-ML-001", category: "Maquillaje", price: 16.00, cost: 8.00, stock: 0, minStock: 5 },
  { id: "8", name: "Fragancia Journey", sku: "MK-FR-001", category: "Fragancias", price: 45.00, cost: 22.50, stock: 4, minStock: 2 },
  { id: "9", name: "Set Brochas Esenciales", sku: "MK-AC-001", category: "Accesorios", price: 55.00, cost: 27.50, stock: 3, minStock: 2 },
];

const categories = ["Todas", "Cuidado de la Piel", "Maquillaje", "Fragancias", "Accesorios"];

export default function Productos() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Todas");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === "Todas" || p.category === category;
    return matchesSearch && matchesCategory;
  });

  const handleSave = (product: Omit<Product, "id">) => {
    if (editingProduct) {
      setProducts(products.map(p => 
        p.id === editingProduct.id ? { ...product, id: editingProduct.id } : p
      ));
    } else {
      const newProduct: Product = {
        ...product,
        id: `p${Date.now()}`,
      };
      setProducts([...products, newProduct]);
    }
    setDialogOpen(false);
    setEditingProduct(null);
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setDialogOpen(true);
  };

  const handleNewProduct = () => {
    setEditingProduct(null);
    setDialogOpen(true);
  };

  const totalValue = products.reduce((sum, p) => sum + (p.price * p.stock), 0);
  const lowStockCount = products.filter(p => p.stock <= p.minStock).length;

  return (
    <div className="p-6 space-y-6" data-testid="page-productos">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Productos</h1>
          <p className="text-muted-foreground">
            {products.length} productos | Valor total: ${totalValue.toFixed(2)} | {lowStockCount} con stock bajo
          </p>
        </div>
        <Button onClick={handleNewProduct} data-testid="button-add-product">
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Producto
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-products"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-category-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredProducts.map((product) => (
          <ProductCard key={product.id} product={product} onEdit={handleEdit} />
        ))}
      </div>

      {filteredProducts.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No se encontraron productos
        </div>
      )}

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editingProduct}
        onSave={handleSave}
      />
    </div>
  );
}
