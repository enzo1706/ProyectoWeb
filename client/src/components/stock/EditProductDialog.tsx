import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import type { Product } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";
import { getProductCategories } from "@/lib/productCategories";
import { Trash2 } from "lucide-react";
import { CategorySelect } from "./CategorySelect";
import { CostInputBlock, resolveCostInputForSubmit, type CostInputValue } from "./CostInputBlock";

const editProductFormSchema = z.object({
  seccion: z.string().trim().min(1, "La categoría es obligatoria").optional(),
  linea: z.string().optional(),
  producto: z.string().trim().min(1, "El nombre del producto es obligatorio").optional(),
  variante: z.string().optional(),
  puntos: z.string().optional(),
  codigo: z.string().optional(),
  precio: z.string().min(1, "El precio es obligatorio"),
  unidades: z.string().min(1, "Las unidades son obligatorias"),
  stockMinimo: z.string().optional(),
});
type EditProductFormData = z.infer<typeof editProductFormSchema>;

/** Deriva el estado inicial del bloque de costo a partir de cómo quedó guardado el producto —
 * si tiene `selectedDiscount`, se cargó por %; si tiene `costPrice` sin `selectedDiscount`, se
 * cargó directo en pesos; si no tiene nada, está "sin costo". */
function initialCostInput(product: Product): CostInputValue {
  if (product.selectedDiscount !== null) {
    return { mode: "percent", percent: product.selectedDiscount, direct: "" };
  }
  if (product.costPrice !== null) {
    return { mode: "direct", percent: null, direct: String(product.costPrice / 100) };
  }
  return { mode: "none", percent: null, direct: "" };
}

function costInputEquals(a: CostInputValue, b: CostInputValue): boolean {
  return a.mode === b.mode && a.percent === b.percent && a.direct === b.direct;
}

export function EditProductDialog({
  open,
  onOpenChange,
  product,
  products,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  products: Product[];
}) {
  const { toast } = useToast();
  const { format } = useHideMoney();
  const isCatalog = product !== null && product.source !== "manual";
  const categories = getProductCategories(products);

  const [costInput, setCostInput] = useState<CostInputValue>({ mode: "none", percent: null, direct: "" });
  const [startingCostInput, setStartingCostInput] = useState<CostInputValue>({ mode: "none", percent: null, direct: "" });
  const [useCatalogPrice, setUseCatalogPrice] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const form = useForm<EditProductFormData>({
    resolver: zodResolver(editProductFormSchema),
    defaultValues: { seccion: "", linea: "", producto: "", variante: "", puntos: "", codigo: "", precio: "", unidades: "", stockMinimo: "" },
  });

  useEffect(() => {
    if (product) {
      form.reset({
        seccion: product.seccion,
        linea: product.linea ?? "",
        producto: product.producto,
        variante: product.variante,
        puntos: String(product.puntos),
        codigo: product.codigo,
        precio: String(product.effectivePrecio / 100),
        unidades: String(product.unidades),
        stockMinimo: product.stockMinimo !== null ? String(product.stockMinimo) : "",
      });
      const initial = initialCostInput(product);
      setCostInput(initial);
      setStartingCostInput(initial);
      setUseCatalogPrice(false);
    }
  }, [product, form]);

  const updateMutation = useGuardedMutation({
    mutationFn: async (data: EditProductFormData) => {
      if (!product) throw new Error("Producto no seleccionado");

      if (isCatalog) {
        const priceOverride = useCatalogPrice ? null : Math.round(Number(data.precio) * 100);
        await apiRequest("PATCH", `/api/products/${product.id}/price-override`, { priceOverride });
      } else {
        await apiRequest("PATCH", `/api/products/${product.id}`, {
          seccion: data.seccion,
          linea: data.linea || undefined,
          producto: data.producto,
          variante: data.variante || undefined,
          puntos: data.puntos ? Number(data.puntos) : 0,
          precio: Math.round(Number(data.precio) * 100),
          codigo: data.codigo || undefined,
        });
      }

      if (!costInputEquals(costInput, startingCostInput)) {
        const costPayload = resolveCostInputForSubmit(costInput);
        if (costPayload) {
          if ("discountPercent" in costPayload) {
            await apiRequest("PATCH", `/api/products/${product.id}/discount`, costPayload);
          } else {
            await apiRequest("PATCH", `/api/products/${product.id}/cost`, costPayload);
          }
        }
      }

      await apiRequest("PATCH", `/api/products/${product.id}/stock`, {
        unidades: Number(data.unidades),
        stockMinimo: !data.stockMinimo || data.stockMinimo.trim() === "" ? null : Number(data.stockMinimo),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
      toast({ title: "Producto actualizado" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo actualizar el producto", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useGuardedMutation({
    mutationFn: async () => {
      if (!product) throw new Error("Producto no seleccionado");
      await apiRequest("DELETE", `/api/products/${product.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/low-stock"] });
      toast({ title: "Producto eliminado" });
      setConfirmDeleteOpen(false);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      // 409 = tiene ventas registradas, no se puede eliminar (mensaje tal cual del backend).
      toast({ title: "No se pudo eliminar el producto", description: err.message, variant: "destructive" });
    },
  });

  if (!product) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col" data-testid="dialog-edit-product">
        <DialogHeader>
          <DialogTitle>Editar producto</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => updateMutation.mutate(data))}
            className="space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain px-1 -mx-1"
          >
            {isCatalog ? (
              <div className="rounded-lg bg-muted/50 px-3 py-2.5 space-y-1 text-sm" data-testid="text-readonly-core-fields">
                <p className="font-medium">{product.producto}</p>
                {product.variante !== "Estándar" && <p className="text-muted-foreground">{product.variante}</p>}
                <p className="text-muted-foreground">
                  {product.linea ? `${product.seccion} · ${product.linea}` : product.seccion}
                </p>
                <p className="text-muted-foreground">
                  {product.puntos > 0 && `${product.puntos} pts · `}
                  Código: {product.codigo}
                </p>
              </div>
            ) : (
              <>
                <FormField
                  control={form.control}
                  name="producto"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre del producto</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-producto" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="seccion"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Categoría</FormLabel>
                      <FormControl>
                        <CategorySelect
                          categories={categories}
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          testIdPrefix="edit-seccion"
                        />
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
                        <Input {...field} data-testid="input-edit-linea" />
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
                        <Input {...field} data-testid="input-edit-variante" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <FormField
              control={form.control}
              name="precio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Precio de venta</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={useCatalogPrice}
                      onChange={(e) => {
                        setUseCatalogPrice(false);
                        field.onChange(e);
                      }}
                      data-testid="input-edit-precio"
                    />
                  </FormControl>
                  {isCatalog && (
                    <FormDescription className="flex items-center justify-between gap-2">
                      <span>Precio del catálogo: {format(product.precio)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 text-xs underline"
                        onClick={() => {
                          setUseCatalogPrice(true);
                          form.setValue("precio", String(product.precio / 100));
                        }}
                        data-testid="button-use-catalog-price"
                      >
                        Usar el precio del catálogo
                      </Button>
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <CostInputBlock
              precioCentavos={Math.round(Number(form.watch("precio") || 0) * 100)}
              value={costInput}
              onChange={setCostInput}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="unidades"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidades</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min={0} step="1" data-testid="input-edit-unidades" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="stockMinimo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Avisarme con menos de</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={1}
                        step="1"
                        placeholder={String(product.effectiveStockMinimo)}
                        data-testid="input-edit-stock-minimo"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {!isCatalog && (
              <FormField
                control={form.control}
                name="puntos"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Puntos (opcional)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min={0} step="1" data-testid="input-edit-puntos" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {!isCatalog && (
              <FormField
                control={form.control}
                name="codigo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código (opcional)</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-codigo" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {!isCatalog && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive w-full justify-start px-0"
                onClick={() => setConfirmDeleteOpen(true)}
                data-testid="button-delete-product"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar producto
              </Button>
            )}

            <DialogFooter className="border-t pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-edit-product">
                {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
      <AlertDialogContent data-testid="dialog-confirm-delete-product">
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar {product.producto}?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. Si el producto tiene ventas registradas, no se va a poder eliminar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-confirm-delete-product-no">No, volver</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
            data-testid="button-confirm-delete-product-yes"
          >
            {deleteMutation.isPending ? "Eliminando..." : "Sí, eliminar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
