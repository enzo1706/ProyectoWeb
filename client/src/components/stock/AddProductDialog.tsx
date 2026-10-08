import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import type { Product } from "@shared/schema";
import { createProductSchema } from "@shared/schema";
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
} from "@/components/ui/form";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown } from "lucide-react";
import { getProductCategories } from "@/lib/productCategories";
import { CategorySelect } from "./CategorySelect";
import { CostInputBlock, EMPTY_COST_INPUT, resolveCostInputForSubmit, type CostInputValue } from "./CostInputBlock";

const manualProductFormSchema = createProductSchema.extend({
  precio: z.string().min(1, "El precio es obligatorio"),
  unidades: z.string().optional(),
  puntos: z.string().optional(),
  variante: z.string().optional(),
  codigo: z.string().optional(),
});
type ManualProductFormData = z.infer<typeof manualProductFormSchema>;

export function AddProductDialog({
  open,
  onOpenChange,
  products,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
}) {
  const { toast } = useToast();
  const categories = getProductCategories(products);
  const [costInput, setCostInput] = useState<CostInputValue>(EMPTY_COST_INPUT);
  const [moreDataOpen, setMoreDataOpen] = useState(false);
  const [confirmNoCostOpen, setConfirmNoCostOpen] = useState(false);

  const { data: settings } = useQuery<{ habitualDiscountPercent: number }>({
    queryKey: ["/api/business-settings"],
    enabled: open,
  });
  const habitualDiscountPercent = Math.round(settings?.habitualDiscountPercent ?? 35);

  const form = useForm<ManualProductFormData>({
    resolver: zodResolver(manualProductFormSchema),
    defaultValues: { seccion: "", linea: "", producto: "", variante: "", precio: "", unidades: "0", puntos: "0", codigo: "" },
  });

  const resetAll = () => {
    form.reset();
    setCostInput(EMPTY_COST_INPUT);
    setMoreDataOpen(false);
  };

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

      const costPayload = resolveCostInputForSubmit(costInput);
      if (costPayload) {
        if ("discountPercent" in costPayload) {
          await apiRequest("PATCH", `/api/products/${created.id}/discount`, costPayload);
        } else {
          await apiRequest("PATCH", `/api/products/${created.id}/cost`, costPayload);
        }
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Producto agregado al catálogo" });
      resetAll();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo agregar el producto", description: err.message, variant: "destructive" });
    },
  });

  const submit = (data: ManualProductFormData) => {
    const costPayload = resolveCostInputForSubmit(costInput);
    if (!costPayload) {
      setConfirmNoCostOpen(true);
      return;
    }
    createMutation.mutate(data);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetAll(); onOpenChange(v); }}>
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col" data-testid="dialog-add-product">
          <DialogHeader>
            <DialogTitle>Cargar producto manualmente</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(submit)}
              className="space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain px-1 -mx-1"
            >
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
                name="seccion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría</FormLabel>
                    <FormControl>
                      <CategorySelect
                        categories={categories}
                        value={field.value}
                        onChange={field.onChange}
                        testIdPrefix="manual-seccion"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="precio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio de venta</FormLabel>
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
                    <FormLabel>Unidades</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min={0} step="1" data-testid="input-manual-unidades" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <CostInputBlock
                precioCentavos={Math.round(Number(form.watch("precio") || 0) * 100)}
                value={costInput}
                onChange={setCostInput}
              />

              <Collapsible open={moreDataOpen} onOpenChange={setMoreDataOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-between px-0 text-muted-foreground"
                    data-testid="button-toggle-more-data"
                  >
                    Más datos (opcional)
                    <ChevronDown className={moreDataOpen ? "h-4 w-4 rotate-180 transition-transform" : "h-4 w-4 transition-transform"} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-2">
                  <FormField
                    control={form.control}
                    name="linea"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Línea</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-manual-linea" />
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
                        <FormLabel>Tono / variante</FormLabel>
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
                      name="puntos"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Puntos</FormLabel>
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
                          <FormLabel>Código</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-manual-codigo" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>

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

      <AlertDialog open={confirmNoCostOpen} onOpenChange={setConfirmNoCostOpen}>
        <AlertDialogContent data-testid="dialog-confirm-no-cost">
          <AlertDialogHeader>
            <AlertDialogTitle>No cargaste el costo</AlertDialogTitle>
            <AlertDialogDescription>
              Vamos a estimar tu ganancia con tu descuento habitual ({habitualDiscountPercent}%). ¿Querés guardarlo igual?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-no-cost-fix">Cargar el costo</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmNoCostOpen(false);
                form.handleSubmit((data) => createMutation.mutate(data))();
              }}
              data-testid="button-no-cost-confirm"
            >
              Guardar igual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
