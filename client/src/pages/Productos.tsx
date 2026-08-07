import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import type { Product } from "@shared/schema";
import { discountOptions } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/currency";
import {
  Package,
  PackageOpen,
  Minus,
  Plus,
  ShoppingBag,
  Sparkles,
  Loader2,
  Search,
  SearchX,
} from "lucide-react";

function CatalogProductCard({ product }: { product: Product }) {
  const { toast } = useToast();
  const [quantity, setQuantity] = useState(1);
  const [discount, setDiscount] = useState<string>(
    product.selectedDiscount ? String(product.selectedDiscount) : "",
  );
  const maxQty = Math.max(product.unidades, 0);
  const outOfStock = maxQty === 0;

  const adjust = (delta: number) => {
    setQuantity((q) => {
      const next = q + delta;
      if (next < 1) return 1;
      if (maxQty > 0 && next > maxQty) return maxQty;
      return next;
    });
  };

  const discountMutation = useGuardedMutation({
    mutationFn: async (discountPercent: number) => {
      const res = await apiRequest("PATCH", `/api/products/${product.id}/discount`, { discountPercent });
      return res.json() as Promise<Product>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Producto seleccionado correctamente" });
    },
    onError: (err: Error) => {
      toast({
        title: "No se pudo guardar la selección",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const selectedDiscount = discount ? Number(discount) : null;
  const cost =
    selectedDiscount !== null
      ? product.selectedDiscount === selectedDiscount && product.costPrice !== null
        ? product.costPrice
        : Math.round(product.precio * (1 - selectedDiscount / 100))
      : null;

  return (
    <Card
      className={cn(
        "flex flex-col overflow-hidden shadow-sm transition-shadow hover:shadow-md",
        outOfStock && "opacity-75",
      )}
      data-testid={`card-product-${product.id}`}
    >
      {product.imagen ? (
        <img
          src={product.imagen}
          alt={product.producto}
          className="h-32 w-full object-cover"
          data-testid={`image-product-${product.id}`}
        />
      ) : (
        <div className="flex h-32 w-full items-center justify-center bg-muted">
          <Package className="h-10 w-10 text-muted-foreground" />
        </div>
      )}
      <CardHeader className="pb-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground truncate">
          {product.seccion} · {product.linea}
        </p>
        <CardTitle className="text-lg font-semibold text-foreground leading-snug line-clamp-2">
          {product.producto}
        </CardTitle>
        <p className="text-xs text-muted-foreground font-mono">{product.codigo}</p>
        {product.variante !== "Estándar" && (
          <p className="text-xs text-muted-foreground">{product.variante}</p>
        )}
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-2xl font-bold text-primary">
            {formatPrice(product.precio)}
          </span>
          {product.puntos > 0 && (
            <Badge
              variant="secondary"
              className="bg-primary/10 text-primary border-0 text-xs"
            >
              {product.puntos} pts
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Package className="h-4 w-4 text-muted-foreground shrink-0" />
          <span
            className={cn(
              outOfStock ? "text-destructive font-medium" : "text-muted-foreground",
            )}
          >
            {outOfStock
              ? "Sin stock"
              : `${product.unidades} unidad${product.unidades !== 1 ? "es" : ""} disponible${product.unidades !== 1 ? "s" : ""}`}
          </span>
        </div>

        <div className="space-y-1.5">
          <Select value={discount} onValueChange={setDiscount}>
            <SelectTrigger data-testid={`select-discount-${product.id}`}>
              <SelectValue placeholder="Elegir descuento" />
            </SelectTrigger>
            <SelectContent>
              {discountOptions.map((pct) => (
                <SelectItem key={pct} value={String(pct)}>
                  {pct}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {cost !== null && (
            <p className="text-sm text-muted-foreground" data-testid={`text-cost-${product.id}`}>
              Costo: <span className="font-semibold text-foreground">{formatPrice(cost)}</span>
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-3 pt-0">
        <div className="flex w-full items-center justify-between rounded-lg border bg-muted p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => adjust(-1)}
            disabled={quantity <= 1 || outOfStock}
            aria-label="Disminuir cantidad"
            data-testid={`button-qty-minus-${product.id}`}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span
            className="min-w-[2rem] text-center font-semibold tabular-nums"
            data-testid={`text-qty-${product.id}`}
          >
            {quantity}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => adjust(1)}
            disabled={outOfStock || (maxQty > 0 && quantity >= maxQty)}
            aria-label="Aumentar cantidad"
            data-testid={`button-qty-plus-${product.id}`}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <Button
          className="w-full bg-primary hover:bg-primary/90"
          disabled={outOfStock || selectedDiscount === null || discountMutation.isPending}
          onClick={() => selectedDiscount !== null && discountMutation.mutate(selectedDiscount)}
          data-testid={`button-select-${product.id}`}
        >
          <ShoppingBag className="h-4 w-4 mr-2" />
          {discountMutation.isPending ? "Guardando..." : "Seleccionar"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function CatalogSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-6 w-full mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-40 mt-3" />
          </CardContent>
          <CardFooter>
            <Skeleton className="h-10 w-full" />
          </CardFooter>
        </Card>
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
  const [search, setSearch] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  const { data: products = [], isLoading, isError, error } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.seccion))).sort(),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchesSearch =
        !term ||
        p.producto.toLowerCase().includes(term) ||
        p.codigo.toLowerCase().includes(term) ||
        p.seccion.toLowerCase().includes(term);
      const matchesCategory = selectedCategories.size === 0 || selectedCategories.has(p.seccion);
      return matchesSearch && matchesCategory;
    });
  }, [products, search, selectedCategories]);

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const seedMutation = useGuardedMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/products/seed");
      return res.json() as Promise<{ count: number; message: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
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
    <div
      className="min-h-full bg-background p-6 space-y-6"
      data-testid="page-productos"
    >
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Package className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Catálogo de Productos
            </h1>
            <p className="text-muted-foreground text-sm">
              Explora el inventario disponible y selecciona productos para tu pedido
            </p>
          </div>
        </div>
        {!isLoading && products.length > 0 && (
          <p className="text-sm text-muted-foreground pl-[3.25rem]">
            {products.length} producto{products.length !== 1 ? "s" : ""} en catálogo
          </p>
        )}
      </header>

      {!isLoading && !isError && products.length > 0 && (
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, código o categoría..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-products"
            />
          </div>
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-2.5">
              {categories.map((category) => {
                const active = selectedCategories.has(category);
                return (
                  <Badge
                    key={category}
                    role="button"
                    tabIndex={0}
                    variant={active ? "default" : "outline"}
                    onClick={() => toggleCategory(category)}
                    className={cn(
                      "cursor-pointer select-none px-3.5 py-2 active-elevate-2",
                      active ? "bg-primary text-primary-foreground" : "text-muted-foreground bg-card",
                    )}
                    data-testid={`filter-category-${category}`}
                  >
                    {category}
                  </Badge>
                );
              })}
            </div>
          )}
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

      {!isLoading && !isError && filteredProducts.length > 0 && (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          data-testid="catalog-grid"
        >
          {filteredProducts.map((product) => (
            <CatalogProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
