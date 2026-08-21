import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { useSaleCart } from "@/hooks/use-sale-cart";
import type { Product } from "@shared/schema";
import { discountOptions, createProductSchema } from "@shared/schema";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useHideMoney } from "@/hooks/use-hide-money";
import { computeDiscountedCost } from "@shared/saleCalculations";
import { isLowStock, isReminderActive } from "@shared/stockAlerts";
import { toDateStr } from "@/lib/date";
import { getProductCategories } from "@/lib/productCategories";
import { ProductSelectionModal } from "@/components/ProductSelectionModal";
import { LoadOrderDialog } from "@/components/LoadOrderDialog";
import type { OrderLine } from "@/components/SaleOrderTable";
import {
  Package,
  PackageOpen,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Loader2,
  Search,
  SearchX,
  Plus,
  PackagePlus,
  ArchiveRestore,
  Archive,
  Pencil,
  Check,
  X,
  AlertTriangle,
  Clock,
} from "lucide-react";

const STOCK_FILTER = "__stock";
const DISCONTINUED_FILTER = "__discontinued";
const MANUAL_FILTER = "__manual";
const ALL_FILTER = "__all";

function CatalogProductCard({
  product,
  globalDiscount,
  onOpen,
  onToggleDiscontinued,
  isTogglingDiscontinued,
  onSetStock,
  isSettingStock,
  onSetReminder,
  isSettingReminder,
}: {
  product: Product;
  globalDiscount: number | null;
  onOpen: () => void;
  onToggleDiscontinued: () => void;
  isTogglingDiscontinued: boolean;
  onSetStock: (unidades: number, stockMinimo?: number | null) => void;
  isSettingStock: boolean;
  onSetReminder: (remindAt: string | null) => void;
  isSettingReminder: boolean;
}) {
  const { format } = useHideMoney();
  const outOfStock = product.unidades <= 0;
  const discountedCost = globalDiscount !== null ? computeDiscountedCost(product.precio, globalDiscount) : null;
  const [editingStock, setEditingStock] = useState(false);
  const [stockInput, setStockInput] = useState("");
  const [thresholdInput, setThresholdInput] = useState("");
  const [remindInput, setRemindInput] = useState("");

  const today = toDateStr(new Date());
  const lowStock = isLowStock(product.unidades, product.effectiveStockMinimo);
  const reminderActive = isReminderActive(product.remindStockAt, today);
  const showAlert = lowStock && !reminderActive;

  const startEditingStock = () => {
    setStockInput(String(product.unidades));
    setThresholdInput(product.stockMinimo !== null ? String(product.stockMinimo) : "");
    setEditingStock(true);
  };

  const confirmStock = () => {
    const parsed = Number(stockInput);
    if (!Number.isInteger(parsed) || parsed < 0) return;
    if (thresholdInput.trim() === "") {
      onSetStock(parsed, null);
    } else {
      const parsedThreshold = Number(thresholdInput);
      if (!Number.isInteger(parsedThreshold) || parsedThreshold < 1) return;
      onSetStock(parsed, parsedThreshold);
    }
    setEditingStock(false);
  };

  const confirmReminder = () => {
    if (!remindInput) return;
    onSetReminder(remindInput);
    setRemindInput("");
  };

  return (
    <Card
      className={cn(
        "flex flex-col overflow-hidden shadow-sm transition-shadow hover:shadow-md cursor-pointer",
        (outOfStock || product.discontinued) && "opacity-75",
      )}
      onClick={onOpen}
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
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground truncate">
            {product.linea ? `${product.seccion} · ${product.linea}` : product.seccion}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 -mt-2 -mr-2"
            title={product.discontinued ? "Reactivar producto" : "Marcar como discontinuado"}
            aria-label={product.discontinued ? "Reactivar producto" : "Marcar como discontinuado"}
            disabled={isTogglingDiscontinued}
            onClick={(e) => {
              e.stopPropagation();
              onToggleDiscontinued();
            }}
            data-testid={`button-toggle-discontinued-${product.id}`}
          >
            {product.discontinued ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
        </div>
        <CardTitle className="text-lg font-semibold text-foreground leading-snug line-clamp-2">
          {product.producto}
        </CardTitle>
        <p className="text-xs text-muted-foreground font-mono">{product.codigo}</p>
        {product.discontinued && (
          <Badge variant="destructive" className="w-fit text-xs">Discontinuado</Badge>
        )}
      </CardHeader>
      <CardContent className="flex-1 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-2xl font-bold text-primary" data-testid={`text-cost-${product.id}`}>
            {format(discountedCost ?? product.precio)}
          </span>
          {product.puntos > 0 && (
            <Badge variant="secondary" className="bg-primary/10 text-primary border-0 text-xs">
              {product.puntos} pts
            </Badge>
          )}
        </div>
        {discountedCost !== null && (
          <p className="text-xs text-muted-foreground">
            PVP: <span className="line-through">{format(product.precio)}</span>
          </p>
        )}
        {editingStock ? (
          <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1.5">
              <div className="space-y-0.5">
                <label className="text-[10px] text-muted-foreground" htmlFor={`input-stock-${product.id}`}>Stock</label>
                <Input
                  id={`input-stock-${product.id}`}
                  type="number"
                  min={0}
                  step="1"
                  value={stockInput}
                  onChange={(e) => setStockInput(e.target.value)}
                  className="h-8 w-16"
                  autoFocus
                  data-testid={`input-stock-${product.id}`}
                />
              </div>
              <div className="space-y-0.5">
                <label className="text-[10px] text-muted-foreground" htmlFor={`input-threshold-${product.id}`}>Umbral</label>
                <Input
                  id={`input-threshold-${product.id}`}
                  type="number"
                  min={1}
                  step="1"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  placeholder={String(product.effectiveStockMinimo)}
                  className="h-8 w-16"
                  data-testid={`input-threshold-${product.id}`}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 self-end"
                title="Guardar stock"
                aria-label="Guardar stock"
                disabled={isSettingStock}
                onClick={confirmStock}
                data-testid={`button-confirm-stock-${product.id}`}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 self-end"
                title="Cancelar edición de stock"
                aria-label="Cancelar edición de stock"
                onClick={() => setEditingStock(false)}
                data-testid={`button-cancel-stock-${product.id}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Umbral vacío = usa el predeterminado ({product.effectiveStockMinimo}).
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <Package className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className={cn(outOfStock ? "text-destructive font-medium" : "text-muted-foreground")}>
              {outOfStock
                ? "Sin stock"
                : `${product.unidades} unidad${product.unidades !== 1 ? "es" : ""} disponible${product.unidades !== 1 ? "s" : ""}`}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              title="Editar mi stock"
              aria-label="Editar mi stock"
              onClick={(e) => {
                e.stopPropagation();
                startEditingStock();
              }}
              data-testid={`button-edit-stock-${product.id}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {showAlert && (
          <div
            className="flex flex-wrap items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400"
            onClick={(e) => e.stopPropagation()}
            data-testid={`alert-low-stock-${product.id}`}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="mr-auto">Poco stock</span>
            <Input
              type="date"
              min={today}
              value={remindInput}
              onChange={(e) => setRemindInput(e.target.value)}
              className="h-7 w-[9.5rem] bg-background text-xs"
              data-testid={`input-remind-date-${product.id}`}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!remindInput || isSettingReminder}
              onClick={confirmReminder}
              data-testid={`button-set-reminder-${product.id}`}
            >
              Recordarme comprar
            </Button>
          </div>
        )}
        {reminderActive && (
          <div
            className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground"
            onClick={(e) => e.stopPropagation()}
            data-testid={`reminder-active-${product.id}`}
          >
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="mr-auto">Te recordamos el {product.remindStockAt}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={isSettingReminder}
              onClick={() => onSetReminder(null)}
              data-testid={`button-cancel-reminder-${product.id}`}
            >
              Cancelar
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-0">
        <Button
          className="w-full bg-primary hover:bg-primary/90"
          disabled={outOfStock}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          data-testid={`button-select-${product.id}`}
        >
          <ShoppingBag className="h-4 w-4 mr-2" />
          {outOfStock ? "Sin stock" : "Agregar"}
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

const manualProductFormSchema = createProductSchema.extend({
  precio: z.string().min(1, "El precio es obligatorio"),
  unidades: z.string().optional(),
  puntos: z.string().optional(),
  // Campos opcionales del schema base (min(1) del lado del servidor) — en el form se aceptan
  // vacíos y se convierten a `undefined` recién al armar el payload, así el vacío no bloquea el submit.
  variante: z.string().optional(),
  codigo: z.string().optional(),
});
type ManualProductFormData = z.infer<typeof manualProductFormSchema>;

function AddProductDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  // El costo de un producto en esta app siempre se calcula a partir de un descuento de
  // compra sobre el precio de lista (mismo modelo que ya usa el resto de Productos) — no
  // existe un campo de "precio de costo" suelto en el backend, así que la alerta de "sin
  // costo" se dispara cuando no se elige ninguno de los descuentos habituales.
  const [purchaseDiscount, setPurchaseDiscount] = useState<string>("");
  const form = useForm<ManualProductFormData>({
    resolver: zodResolver(manualProductFormSchema),
    defaultValues: { seccion: "", linea: "", producto: "", variante: "", precio: "", unidades: "0", puntos: "0", codigo: "" },
  });

  const createMutation = useGuardedMutation({
    mutationFn: async (data: ManualProductFormData) => {
      const res = await apiRequest("POST", "/api/products", {
        seccion: data.seccion,
        linea: data.linea || undefined,
        producto: data.producto,
        variante: data.variante || undefined,
        precio: Math.round(Number(data.precio) * 100),
        unidades: data.unidades ? Number(data.unidades) : 0,
        puntos: data.puntos ? Number(data.puntos) : 0,
        codigo: data.codigo || undefined,
      });
      const created = (await res.json()) as Product;
      if (purchaseDiscount) {
        await apiRequest("PATCH", `/api/products/${created.id}/discount`, { discountPercent: Number(purchaseDiscount) });
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Producto agregado al catálogo" });
      form.reset();
      setPurchaseDiscount("");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo agregar el producto", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-add-product">
        <DialogHeader>
          <DialogTitle>Agregar producto manualmente</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => createMutation.mutate(data))}
            className="space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain px-1 -mx-1"
          >
            <FormField
              control={form.control}
              name="seccion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-manual-seccion" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="linea"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Línea (opcional)</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-manual-linea" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="producto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del producto</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-manual-producto" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="variante"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tono / variante (opcional)</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-manual-variante" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="precio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio público</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min={0} step="0.01" data-testid="input-manual-precio" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="unidades"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stock inicial</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min={0} step="1" data-testid="input-manual-unidades" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="puntos"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Puntos (opcional)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min={0} step="1" data-testid="input-manual-puntos" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="codigo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código (opcional)</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-manual-codigo" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div>
              <FormLabel className="text-sm font-medium">Descuento de compra (opcional)</FormLabel>
              <Select value={purchaseDiscount || "none"} onValueChange={(v) => setPurchaseDiscount(v === "none" ? "" : v)}>
                <SelectTrigger className="mt-1.5" data-testid="select-manual-purchase-discount">
                  <SelectValue placeholder="Sin descuento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" data-testid="option-manual-purchase-discount-none">Sin descuento</SelectItem>
                  {discountOptions.map((pct) => (
                    <SelectItem key={pct} value={String(pct)} data-testid={`option-manual-purchase-discount-${pct}`}>{pct}%</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!purchaseDiscount && (
                <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Sin descuento de compra: no vas a poder ver el costo real de este producto hasta que lo completes.</span>
                </div>
              )}
            </div>

            <DialogFooter className="border-t pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-manual-product">
                {createMutation.isPending ? "Guardando..." : "Agregar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Productos() {
  const { toast } = useToast();
  const { format } = useHideMoney();
  const [, setLocation] = useLocation();
  const cart = useSaleCart();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_FILTER);
  const [globalDiscount, setGlobalDiscount] = useState<string>("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [loadOrderOpen, setLoadOrderOpen] = useState(false);

  const { data: products = [], isLoading, isError, error } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const categories = useMemo(() => getProductCategories(products), [products]);
  const discountValue = globalDiscount ? Number(globalDiscount) : null;

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchesSearch =
        !term ||
        p.producto.toLowerCase().includes(term) ||
        p.codigo.toLowerCase().includes(term) ||
        p.seccion.toLowerCase().includes(term);

      let matchesCategory = true;
      if (categoryFilter === STOCK_FILTER) matchesCategory = p.unidades > 0;
      else if (categoryFilter === DISCONTINUED_FILTER) matchesCategory = p.discontinued;
      else if (categoryFilter === MANUAL_FILTER) matchesCategory = p.source === "manual";
      else if (categoryFilter !== ALL_FILTER) matchesCategory = p.seccion === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [products, search, categoryFilter]);

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

  const [togglingId, setTogglingId] = useState<number | null>(null);
  const toggleDiscontinuedMutation = useGuardedMutation({
    mutationFn: async ({ id, discontinued }: { id: number; discontinued: boolean }) => {
      setTogglingId(id);
      const res = await apiRequest("PATCH", `/api/products/${id}/discontinued`, { discontinued });
      return res.json() as Promise<Product>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo actualizar el producto", description: err.message, variant: "destructive" });
    },
    onSettled: () => setTogglingId(null),
  });

  const [settingStockId, setSettingStockId] = useState<number | null>(null);
  const setStockMutation = useGuardedMutation({
    mutationFn: async ({ id, unidades, stockMinimo }: { id: number; unidades: number; stockMinimo?: number | null }) => {
      setSettingStockId(id);
      const body: { unidades: number; stockMinimo?: number | null } = { unidades };
      if (stockMinimo !== undefined) body.stockMinimo = stockMinimo;
      const res = await apiRequest("PATCH", `/api/products/${id}/stock`, body);
      return res.json() as Promise<Product>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
      toast({ title: "Stock actualizado" });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo actualizar el stock", description: err.message, variant: "destructive" });
    },
    onSettled: () => setSettingStockId(null),
  });

  const [settingReminderId, setSettingReminderId] = useState<number | null>(null);
  const setReminderMutation = useGuardedMutation({
    mutationFn: async ({ id, remindAt }: { id: number; remindAt: string | null }) => {
      setSettingReminderId(id);
      const res = await apiRequest("PATCH", `/api/products/${id}/stock-reminder`, { remindAt });
      return res.json() as Promise<Product>;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
      toast({ title: variables.remindAt ? "Te vamos a recordar comprarlo" : "Recordatorio cancelado" });
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo guardar el recordatorio", description: err.message, variant: "destructive" });
    },
    onSettled: () => setSettingReminderId(null),
  });

  const cartSubtotal = cart.lines.reduce((sum, l) => {
    const price = l.mode === "manualPrice" && l.adjustmentValue !== null ? l.adjustmentValue : l.originalPrice;
    return sum + price * l.quantity;
  }, 0);

  return (
    <div
      className="min-h-full bg-background p-6 space-y-6 pb-24"
      data-testid="page-productos"
    >
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                Catálogo de Productos
              </h1>
              <p className="text-muted-foreground text-sm">
                Elegí el descuento de compra, filtrá por categoría y armá tu pedido
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setAddProductOpen(true)} data-testid="button-open-add-product">
              <Plus className="h-4 w-4 mr-2" />
              Agregar producto
            </Button>
            <Button onClick={() => setLoadOrderOpen(true)} data-testid="button-open-load-order">
              <PackagePlus className="h-4 w-4 mr-2" />
              Cargar pedido
            </Button>
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
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, código o categoría..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-products"
              />
            </div>
            <Select value={globalDiscount || "none"} onValueChange={(v) => setGlobalDiscount(v === "none" ? "" : v)}>
              <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-global-discount">
                <SelectValue placeholder="Descuento de compra" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin descuento</SelectItem>
                {discountOptions.map((pct) => (
                  <SelectItem key={pct} value={String(pct)}>
                    Descuento de compra: {pct}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1" data-testid="category-chip-row">
            {[
              { value: ALL_FILTER, label: "Todas" },
              ...categories.map((c) => ({ value: c, label: c })),
              { value: STOCK_FILTER, label: "En stock" },
              { value: DISCONTINUED_FILTER, label: "Discontinuos" },
              { value: MANUAL_FILTER, label: "Agregados manualmente" },
            ].map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => setCategoryFilter(chip.value)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium",
                  categoryFilter === chip.value ? "border-primary bg-primary text-primary-foreground" : "bg-muted/50",
                )}
                data-testid={`chip-category-${chip.value}`}
              >
                {chip.label}
              </button>
            ))}
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

      {!isLoading && !isError && filteredProducts.length > 0 && (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          data-testid="catalog-grid"
        >
          {filteredProducts.map((product) => (
            <CatalogProductCard
              key={product.id}
              product={product}
              globalDiscount={discountValue}
              onOpen={() => setSelectedProduct(product)}
              onToggleDiscontinued={() =>
                toggleDiscontinuedMutation.mutate({ id: product.id, discontinued: !product.discontinued })
              }
              isTogglingDiscontinued={togglingId === product.id}
              onSetStock={(unidades, stockMinimo) => setStockMutation.mutate({ id: product.id, unidades, stockMinimo })}
              isSettingStock={settingStockId === product.id}
              onSetReminder={(remindAt) => setReminderMutation.mutate({ id: product.id, remindAt })}
              isSettingReminder={settingReminderId === product.id}
            />
          ))}
        </div>
      )}

      <ProductSelectionModal
        open={selectedProduct !== null}
        onOpenChange={(open) => !open && setSelectedProduct(null)}
        product={selectedProduct}
        allProducts={products}
        globalDiscount={discountValue}
        onAdd={(line: OrderLine) => cart.addLine(line)}
      />

      <AddProductDialog open={addProductOpen} onOpenChange={setAddProductOpen} />

      <LoadOrderDialog open={loadOrderOpen} onOpenChange={setLoadOrderOpen} products={products} />

      {cart.lines.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur-sm p-4 shadow-lg z-40">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm">
              <ShoppingCart className="h-5 w-5 text-primary" />
              <span data-testid="text-cart-summary">
                {cart.lines.length} producto{cart.lines.length !== 1 ? "s" : ""} · {format(cartSubtotal)}
              </span>
            </div>
            <Button onClick={() => setLocation("/ventas")} data-testid="button-go-to-sale">
              Ir a Ventas
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
