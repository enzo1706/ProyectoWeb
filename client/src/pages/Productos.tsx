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
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { isLowStock, isReminderActive } from "@shared/stockAlerts";
import { toDateStr } from "@/lib/date";
import { getProductCategories, getToneSiblings, toneFamilyKey } from "@/lib/productCategories";
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
  Pencil,
  Check,
  X,
  AlertTriangle,
  Clock,
  ChevronDown,
} from "lucide-react";

const MANUAL_FILTER = "__manual";
const ALL_FILTER = "__all";

/** Stock + umbral + recordatorio de compra de un producto puntual (una fila = un producto,
 * o un tono dentro de un producto con variantes). Misma lógica/mutaciones que ya existían,
 * solo reempaquetada para poder reusarla tanto en filas simples como en cada tono. */
function ProductStockCell({
  product,
  onSetStock,
  isSettingStock,
}: {
  product: Product;
  onSetStock: (unidades: number, stockMinimo?: number | null) => void;
  isSettingStock: boolean;
}) {
  const outOfStock = product.unidades <= 0;
  const [editingStock, setEditingStock] = useState(false);
  const [stockInput, setStockInput] = useState("");
  const [thresholdInput, setThresholdInput] = useState("");

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

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {editingStock ? (
        <div className="flex items-center gap-1.5">
          <Input
            id={`input-stock-${product.id}`}
            type="number"
            min={0}
            step="1"
            value={stockInput}
            onChange={(e) => setStockInput(e.target.value)}
            className="h-8 w-14"
            autoFocus
            aria-label="Stock"
            data-testid={`input-stock-${product.id}`}
          />
          <Input
            id={`input-threshold-${product.id}`}
            type="number"
            min={1}
            step="1"
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            placeholder={String(product.effectiveStockMinimo)}
            className="h-8 w-14"
            aria-label="Umbral de stock bajo"
            title={`Umbral vacío = usa el predeterminado (${product.effectiveStockMinimo})`}
            data-testid={`input-threshold-${product.id}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
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
            className="h-8 w-8 shrink-0"
            title="Cancelar edición de stock"
            aria-label="Cancelar edición de stock"
            onClick={() => setEditingStock(false)}
            data-testid={`button-cancel-stock-${product.id}`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-sm">
          <span className={cn("tabular-nums whitespace-nowrap", outOfStock ? "text-destructive font-medium" : "text-muted-foreground")}>
            {outOfStock ? "Sin stock" : `${product.unidades} uds`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title="Editar stock"
            aria-label="Editar stock"
            onClick={startEditingStock}
            data-testid={`button-edit-stock-${product.id}`}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

/** Indicador de poco stock / recordatorio activo — a ancho completo de la fila (no en la
 * columna angosta de la derecha). El disparador para FIJAR un recordatorio ya no vive acá
 * (se centralizó en la notificación general "Recordar stock" de más arriba) — esto solo
 * informa el estado y deja cancelar un recordatorio puntual ya activo. */
function ProductStockAlerts({
  product,
  onSetReminder,
  isSettingReminder,
}: {
  product: Product;
  onSetReminder: (remindAt: string | null) => void;
  isSettingReminder: boolean;
}) {
  const today = toDateStr(new Date());
  const lowStock = isLowStock(product.unidades, product.effectiveStockMinimo);
  const reminderActive = isReminderActive(product.remindStockAt, today);
  const showAlert = lowStock && !reminderActive;

  if (!showAlert && !reminderActive) return null;

  return (
    <div className="px-3 pb-2" onClick={(e) => e.stopPropagation()}>
      {showAlert && (
        <div
          className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400"
          data-testid={`alert-low-stock-${product.id}`}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Poco stock</span>
        </div>
      )}
      {reminderActive && (
        <div
          className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground"
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
    </div>
  );
}

interface StockActions {
  onSetStock: (id: number, unidades: number, stockMinimo?: number | null) => void;
  isSettingStock: (id: number) => boolean;
  onSetReminder: (id: number, remindAt: string | null) => void;
  isSettingReminder: (id: number) => boolean;
}

/** Fila compacta de un producto puntual (sin tonos, o un tono dentro de un grupo expandido).
 * `compact=true` la usan los tonos: sin foto/categoría, solo el nombre del tono + su stock. */
function ProductRow({
  product,
  onOpen,
  actions,
  compact = false,
}: {
  product: Product;
  onOpen: () => void;
  actions: StockActions;
  compact?: boolean;
}) {
  const { format } = useHideMoney();
  const outOfStock = product.unidades <= 0;

  return (
    <div data-testid={`row-product-${product.id}`}>
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 hover-elevate cursor-pointer",
          outOfStock && "opacity-75",
          compact && "pl-4",
        )}
        onClick={onOpen}
      >
        {!compact && (
          product.imagen ? (
            <img
              src={product.imagen}
              alt={product.producto}
              className="h-11 w-11 rounded-md object-cover shrink-0"
              data-testid={`image-product-${product.id}`}
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted shrink-0">
              <Package className="h-5 w-5 text-muted-foreground" />
            </div>
          )
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate text-sm" data-testid={`text-name-${product.id}`}>
            {compact ? product.variante : product.producto}
          </p>
          {!compact && (
            <p className="text-xs text-muted-foreground truncate">
              {product.linea ? `${product.seccion} · ${product.linea}` : product.seccion}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <div className="flex items-baseline gap-1.5">
            {product.puntos > 0 && (
              <Badge variant="secondary" className="bg-primary/10 text-primary border-0 text-[10px] px-1.5 py-0">
                {product.puntos} pts
              </Badge>
            )}
            <span className="text-sm font-semibold" data-testid={`text-cost-${product.id}`}>
              {format(product.costPrice ?? product.precio)}
            </span>
          </div>
          <ProductStockCell
            product={product}
            onSetStock={(unidades, stockMinimo) => actions.onSetStock(product.id, unidades, stockMinimo)}
            isSettingStock={actions.isSettingStock(product.id)}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={outOfStock}
          title={outOfStock ? "Sin stock" : "Agregar"}
          aria-label={outOfStock ? "Sin stock" : "Agregar"}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          data-testid={`button-select-${product.id}`}
        >
          <ShoppingBag className="h-4 w-4" />
        </Button>
      </div>
      <ProductStockAlerts
        product={product}
        onSetReminder={(remindAt) => actions.onSetReminder(product.id, remindAt)}
        isSettingReminder={actions.isSettingReminder(product.id)}
      />
    </div>
  );
}

/** Un producto sin tonos se renderiza directo como ProductRow. Un producto con tonos se
 * agrupa en una sola fila expandible que muestra el stock de cada tono al desplegarse. */
function ProductGroup({
  members,
  onOpen,
  actions,
}: {
  members: Product[];
  onOpen: (product: Product) => void;
  actions: StockActions;
}) {
  const [expanded, setExpanded] = useState(false);

  if (members.length === 1) {
    return (
      <ProductRow product={members[0]} onOpen={() => onOpen(members[0])} actions={actions} />
    );
  }

  const primary = members[0];
  const totalUnidades = members.reduce((sum, m) => sum + m.unidades, 0);
  const anyLowStock = members.some((m) => isLowStock(m.unidades, m.effectiveStockMinimo) && !isReminderActive(m.remindStockAt, toDateStr(new Date())));

  return (
    <div data-testid={`group-product-${primary.id}`}>
      <div
        className="flex items-center gap-3 px-3 py-2.5 hover-elevate cursor-pointer"
        onClick={() => onOpen(primary)}
        data-testid={`row-group-${primary.id}`}
      >
        {primary.imagen ? (
          <img
            src={primary.imagen}
            alt={primary.producto}
            className="h-11 w-11 rounded-md object-cover shrink-0"
            data-testid={`image-product-${primary.id}`}
          />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted shrink-0">
            <Package className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate text-sm">{primary.producto}</p>
          <p className="text-xs text-muted-foreground truncate">
            {primary.linea ? `${primary.seccion} · ${primary.linea}` : primary.seccion}
            {" · "}
            {members.length} tonos
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {anyLowStock && <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
          <span className="text-sm tabular-nums text-muted-foreground whitespace-nowrap">{totalUnidades} uds</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title={expanded ? "Ocultar tonos" : "Ver tonos"}
            aria-label={expanded ? "Ocultar tonos" : "Ver tonos"}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            data-testid={`button-toggle-tones-${primary.id}`}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="divide-y border-t bg-muted/20" data-testid={`tones-${primary.id}`}>
          {members.map((m) => (
            <ProductRow key={m.id} product={m} onOpen={() => onOpen(m)} actions={actions} compact />
          ))}
        </div>
      )}
    </div>
  );
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
  // Por defecto solo se ven productos con stock > 0 — el checkbox habilita ver también los de 0.
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [loadOrderOpen, setLoadOrderOpen] = useState(false);
  const [bulkReminderDate, setBulkReminderDate] = useState("");

  const { data: products = [], isLoading, isError, error } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  // Mismo endpoint que ya usa el Dashboard para esto — filtra server-side por INNER JOIN a
  // product_stock, así que solo trae productos que la consultora realmente compró alguna vez
  // (nunca los del catálogo global que todavía tienen 0 unidades por defecto, sin tocar).
  const { data: lowStockRaw = [] } = useQuery<Product[]>({
    queryKey: ["/api/products/low-stock"],
  });

  const categories = useMemo(() => getProductCategories(products), [products]);

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
  // aparezcan como una sola fila expandible en vez de una fila por variante — misma
  // heurística que ya usa ProductSelectionModal (getToneSiblings), acá aplicada de una
  // sola pasada sobre la lista ya filtrada en vez de un lookup por producto.
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

  const stockActions: StockActions = {
    onSetStock: (id, unidades, stockMinimo) => setStockMutation.mutate({ id, unidades, stockMinimo }),
    isSettingStock: (id) => settingStockId === id,
    onSetReminder: (id, remindAt) => setReminderMutation.mutate({ id, remindAt }),
    isSettingReminder: (id) => settingReminderId === id,
  };

  // lowStockRaw ya viene filtrado server-side a productos realmente comprados alguna vez
  // (nunca los del catálogo global sin tocar). Acá solo se excluyen, con la misma condición
  // que ya usa cada fila y el Dashboard, los que ya tienen un recordatorio activo — para
  // armar la notificación general y la lista de productos a los que aplica "Recordar stock".
  const lowStockProducts = useMemo(() => {
    const today = toDateStr(new Date());
    return lowStockRaw.filter((p) => !isReminderActive(p.remindStockAt, today));
  }, [lowStockRaw]);

  const bulkReminderMutation = useGuardedMutation({
    mutationFn: async (remindAt: string) => {
      const targets = lowStockProducts;
      const results = await Promise.allSettled(
        targets.map((p) => apiRequest("PATCH", `/api/products/${p.id}/stock-reminder`, { remindAt })),
      );
      const failedCount = results.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        throw new Error(`No se pudo aplicar el recordatorio a ${failedCount} de ${targets.length} producto(s)`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
      toast({ title: "Recordatorio aplicado a todos los productos con stock bajo" });
      setBulkReminderDate("");
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "No se pudo aplicar el recordatorio", description: err.message, variant: "destructive" });
    },
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
          <h1 className="text-3xl font-bold text-foreground">Stock</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="button-open-cargar">
                <Plus className="h-4 w-4 mr-2" />
                Cargar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setAddProductOpen(true)} data-testid="option-cargar-producto">
                <Package className="h-4 w-4 mr-2" />
                Cargar producto
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLoadOrderOpen(true)} data-testid="option-cargar-pedido">
                <PackagePlus className="h-4 w-4 mr-2" />
                Cargar pedido
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {!isLoading && products.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {products.length} producto{products.length !== 1 ? "s" : ""} en catálogo
          </p>
        )}
      </header>

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

          {lowStockProducts.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
              data-testid="notification-low-stock"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="font-medium">
                Tenés {lowStockProducts.length} producto{lowStockProducts.length !== 1 ? "s" : ""} con stock bajo
              </span>
              <div className="flex items-center gap-1.5 sm:ml-auto">
                <Input
                  type="date"
                  min={toDateStr(new Date())}
                  value={bulkReminderDate}
                  onChange={(e) => setBulkReminderDate(e.target.value)}
                  className="h-8 w-[9.5rem] bg-background text-xs"
                  data-testid="input-bulk-remind-date"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs bg-background"
                  disabled={!bulkReminderDate || bulkReminderMutation.isPending}
                  onClick={() => bulkReminderMutation.mutate(bulkReminderDate)}
                  data-testid="button-bulk-remind-stock"
                >
                  {bulkReminderMutation.isPending ? "Aplicando..." : "Recordar stock"}
                </Button>
              </div>
            </div>
          )}

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
                onOpen={(product) => setSelectedProduct(product)}
                actions={stockActions}
              />
            ))}
          </div>
        </Card>
      )}

      <ProductSelectionModal
        open={selectedProduct !== null}
        onOpenChange={(open) => !open && setSelectedProduct(null)}
        product={selectedProduct}
        allProducts={products}
        globalDiscount={null}
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
