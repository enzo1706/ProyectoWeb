import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import type { Product, Draft } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";
import { getProductCategories, toneFamilyKey } from "@/lib/productCategories";
import { LoadOrderDialog } from "@/components/LoadOrderDialog";
import { UnfinishedDraftsSection } from "@/components/UnfinishedDraftsSection";
import { AddProductDialog } from "@/components/stock/AddProductDialog";
import { EditProductDialog } from "@/components/stock/EditProductDialog";
import { ProductGroup } from "@/components/stock/ProductRow";
import {
  Package,
  PackageOpen,
  Sparkles,
  Loader2,
  Search,
  SearchX,
  Plus,
  PackagePlus,
} from "lucide-react";

const MANUAL_FILTER = "__manual";
const ALL_FILTER = "__all";

interface StockValuationData {
  valueAtCost: number;
  valueAtPrice: number;
  potentialProfit: number;
  productCount: number;
  unitCount: number;
  hasEstimatedCost: boolean;
}

function CatalogSkeleton() {
  return (
    <div className="divide-y rounded-lg border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="h-11 w-11 rounded-md shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function EmptyCatalog({ onSeed, isSeeding }: { onSeed: () => void; isSeeding: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-muted-foreground/30 bg-muted/30 px-6 py-16 text-center"
      data-testid="empty-catalog"
    >
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
        <PackageOpen className="h-10 w-10 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground">
        El catálogo aún está vacío
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Cuando el administrador cargue productos aparecerán aquí. Mientras tanto,
        puedes cargar 6 productos de demostración con temática Mary Kay.
      </p>
      <Button
        size="lg"
        className="mt-8 bg-primary hover:bg-primary/90 shadow-sm"
        onClick={onSeed}
        disabled={isSeeding}
        data-testid="button-seed-catalog"
      >
        {isSeeding ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Cargando productos...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-2" />
            Cargar catálogo de prueba
          </>
        )}
      </Button>
    </div>
  );
}

function NoMatches() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-search">
      <SearchX className="h-10 w-10 text-muted-foreground mb-3" />
      <p className="text-muted-foreground">No se encontraron productos con esos criterios</p>
    </div>
  );
}

export default function Productos() {
  const { toast } = useToast();
  const { format } = useHideMoney();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_FILTER);
  // Por defecto solo se ven productos con stock > 0 — el checkbox habilita ver también los de 0.
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  // Prompt 4: alternar entre ver el precio de venta al público o el costo de cada producto.
  const [showPublicPrice, setShowPublicPrice] = useState(true);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [loadOrderOpen, setLoadOrderOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [resumingOrderDraft, setResumingOrderDraft] = useState<Draft | null>(null);

  const { data: products = [], isLoading, isError, error } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const stockValuationQuery = useQuery<StockValuationData>({
    queryKey: ["/api/reports/stock-valuation"],
  });

  const categories = useMemo(() => getProductCategories(products), [products]);

  const totalUnidades = useMemo(() => products.reduce((sum, p) => sum + p.unidades, 0), [products]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchesSearch =
        !term ||
        p.producto.toLowerCase().includes(term) ||
        p.codigo.toLowerCase().includes(term) ||
        p.seccion.toLowerCase().includes(term);

      let matchesCategory = true;
      if (categoryFilter === MANUAL_FILTER) matchesCategory = p.source === "manual";
      else if (categoryFilter !== ALL_FILTER) matchesCategory = p.seccion === categoryFilter;

      const matchesStock = showOutOfStock || p.unidades > 0;

      return matchesSearch && matchesCategory && matchesStock;
    });
  }, [products, search, categoryFilter, showOutOfStock]);

  // Agrupa por familia (sección+línea+nombre) para que los tonos de un mismo producto
  // aparezcan como una sola fila expandible en vez de una fila por variante.
  const groupedProducts = useMemo(() => {
    const groups = new Map<string, Product[]>();
    for (const p of filteredProducts) {
      const key = toneFamilyKey(p);
      const existing = groups.get(key);
      if (existing) existing.push(p);
      else groups.set(key, [p]);
    }
    const result = Array.from(groups.values());
    for (const members of result) {
      members.sort((a, b) => a.variante.localeCompare(b.variante));
    }
    return result;
  }, [filteredProducts]);

  const seedMutation = useGuardedMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/products/seed");
      return res.json() as Promise<{ count: number; message: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Catálogo listo",
        description: `${data.count} productos de prueba cargados correctamente.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "No se pudo cargar el catálogo",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-full bg-background p-6 space-y-6" data-testid="page-productos">
      <UnfinishedDraftsSection type="order" title="Pedidos sin terminar" onResume={setResumingOrderDraft} />

      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-foreground">Stock</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="button-open-agregar">
                <Plus className="h-4 w-4 mr-2" />
                Agregar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem
                onClick={() => setLoadOrderOpen(true)}
                className="flex flex-col items-start gap-0.5 py-2.5"
                data-testid="option-agregar-pedido"
              >
                <span className="flex items-center gap-2 font-medium">
                  <PackagePlus className="h-4 w-4" />
                  Cargar desde el catálogo
                </span>
                <span className="text-xs text-muted-foreground">
                  Productos del catálogo que compraste en tu pedido.
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setAddProductOpen(true)}
                className="flex flex-col items-start gap-0.5 py-2.5"
                data-testid="option-agregar-producto"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Package className="h-4 w-4" />
                  Cargar producto manualmente
                </span>
                <span className="text-xs text-muted-foreground">
                  Productos que no están en el catálogo.
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {!isLoading && products.length > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="text-catalog-summary">
            {products.length} producto{products.length !== 1 ? "s" : ""} · {totalUnidades} unidad{totalUnidades !== 1 ? "es" : ""}
          </p>
        )}
      </header>

      {!isLoading && !isError && products.length > 0 && (
        <Card data-testid="card-stock-value">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Valor de tu stock</CardTitle>
          </CardHeader>
          <CardContent>
            {stockValuationQuery.isLoading ? (
              <div className="grid grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">A precio de venta</p>
                  <p className="font-semibold" data-testid="text-stock-value-price">
                    {format(stockValuationQuery.data?.valueAtPrice ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">A costo</p>
                  <p className="font-semibold" data-testid="text-stock-value-cost">
                    {stockValuationQuery.data?.hasEstimatedCost ? "≈ " : ""}
                    {format(stockValuationQuery.data?.valueAtCost ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Ganancia potencial</p>
                  <p className="font-semibold text-primary" data-testid="text-stock-value-profit">
                    {stockValuationQuery.data?.hasEstimatedCost ? "≈ " : ""}
                    {format(stockValuationQuery.data?.potentialProfit ?? 0)}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && products.length > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o categoría..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-products"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="select-category-filter" className="text-sm text-muted-foreground shrink-0">
                Categoría
              </Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger id="select-category-filter" className="w-full sm:w-[200px]" data-testid="select-category-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER} data-testid="option-category-todas">Todas</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c} data-testid={`option-category-${c}`}>{c}</SelectItem>
                  ))}
                  <SelectItem value={MANUAL_FILTER} data-testid="option-category-manual">Agregados manualmente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="check-show-out-of-stock"
                checked={showOutOfStock}
                onCheckedChange={(v) => setShowOutOfStock(v === true)}
                data-testid="checkbox-show-out-of-stock"
              />
              <Label htmlFor="check-show-out-of-stock" className="text-sm font-normal cursor-pointer">
                Ver productos sin stock
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="check-show-public-price"
                checked={showPublicPrice}
                onCheckedChange={(v) => setShowPublicPrice(v === true)}
                data-testid="checkbox-show-public-price"
              />
              <Label htmlFor="check-show-public-price" className="text-sm font-normal cursor-pointer">
                Ver precio de venta al público
              </Label>
            </div>
          </div>
        </div>
      )}

      {isLoading && <CatalogSkeleton />}

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Error al cargar el catálogo: {(error as Error).message}
        </div>
      )}

      {!isLoading && !isError && products.length === 0 && (
        <EmptyCatalog
          onSeed={() => seedMutation.mutate()}
          isSeeding={seedMutation.isPending}
        />
      )}

      {!isLoading && !isError && products.length > 0 && filteredProducts.length === 0 && <NoMatches />}

      {!isLoading && !isError && groupedProducts.length > 0 && (
        <Card className="overflow-hidden p-0" data-testid="catalog-list">
          <div className="divide-y">
            {groupedProducts.map((members) => (
              <ProductGroup
                key={members[0].id}
                members={members}
                onEdit={(product) => setEditingProduct(product)}
                showPrice={showPublicPrice}
              />
            ))}
          </div>
        </Card>
      )}

      <AddProductDialog open={addProductOpen} onOpenChange={setAddProductOpen} products={products} />

      <EditProductDialog
        open={editingProduct !== null}
        onOpenChange={(open) => !open && setEditingProduct(null)}
        product={editingProduct}
        products={products}
      />

      <LoadOrderDialog
        open={loadOrderOpen || resumingOrderDraft !== null}
        onOpenChange={(next) => {
          if (!next) {
            setLoadOrderOpen(false);
            setResumingOrderDraft(null);
          }
        }}
        products={products}
        draftToResume={resumingOrderDraft}
      />
    </div>
  );
}
