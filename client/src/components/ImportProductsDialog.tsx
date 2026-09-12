import { useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Upload, FileSpreadsheet, FileText, Loader2, Check, ChevronsUpDown, Package, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";
import { extractFriendlyErrorMessage } from "@/lib/queryClient";
import { formatProductLabel } from "@shared/imageMatching";
import { cn } from "@/lib/utils";
import type { Product } from "@shared/schema";

/**
 * Etapa 5 — importación de productos/pedido desde Excel/CSV/PDF, cruzando contra el catálogo
 * real. Todo el parseo (incluido PDF) corre en el backend (POST /api/products/import/parse) —
 * este componente solo sube el archivo, muestra el preview, y deja que la consultora resuelva
 * lo ambiguo/no encontrado a mano. Nunca decide un producto por su cuenta.
 *
 * El precio y los puntos que se muestran SIEMPRE vienen de `product` (la respuesta del
 * backend, que a su vez viene de nuestra DB) — nunca de ningún valor del archivo, que ni
 * siquiera llega hasta acá (el backend ya lo descartó).
 */

type MatchStatus = "matched" | "ambiguous" | "not_found";

interface MatchCandidate {
  id: number;
  producto: string;
  variante: string;
  seccion: string;
  precio: number;
  puntos: number;
  imagen: string | null;
}

interface MatchResult {
  sourceName: string;
  quantity: number;
  status: MatchStatus;
  product: MatchCandidate | null;
  candidates: MatchCandidate[];
}

interface ImportSummary {
  total: number;
  matched: number;
  ambiguous: number;
  notFound: number;
  zeroQuantity: number;
}

/** Lo mínimo necesario para resolver una fila (elegir a mano o clickear un candidato) — tanto
 * un `Product` completo (del picker) como un `MatchCandidate` (de una fila ambigua) cumplen
 * esta forma, sin necesitar ningún cast inseguro entre ellos. */
type ResolvableProduct = Pick<Product, "id" | "producto" | "variante" | "seccion" | "precio" | "puntos" | "imagen">;

export interface ImportedOrderLine {
  productId: number;
  productName: string;
  category: string;
  precio: number;
  quantity: number;
}

interface ImportProductsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Catálogo completo de la consultora (global + propio) — para el picker de resolución
   * manual. Ya lo tiene quien abre este diálogo (LoadOrderDialog), no hace falta refetchear. */
  products: Product[];
  onImport: (lines: ImportedOrderLine[]) => void;
}

type Stage = "upload" | "uploading" | "preview";

/** Fila con la resolución manual ya aplicada, si corresponde — `product` puede venir del
 * match automático o de que la consultora haya elegido uno para una fila ambigua/no
 * encontrada. `included` es independiente de `product`: una fila resuelta puede igual
 * quedar afuera (ej. cantidad 0 que no interesa cargar). */
interface PreviewRow extends MatchResult {
  included: boolean;
}

function ImportProductPicker({
  products,
  onSelect,
}: {
  products: Product[];
  onSelect: (product: ResolvableProduct) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" data-testid="button-import-resolve">
          Buscar producto
          <ChevronsUpDown className="ml-1.5 h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] sm:w-[380px] p-0">
        <Command>
          <CommandInput placeholder="Buscar por nombre..." data-testid="input-import-resolve-search" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.producto} ${p.variante}`}
                  onSelect={() => {
                    onSelect(p);
                    setOpen(false);
                  }}
                  className="items-start"
                  data-testid={`option-import-resolve-${p.id}`}
                >
                  <Package className="mr-2 h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="whitespace-normal break-words leading-snug">{formatProductLabel(p)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function StatusBadge({ status }: { status: MatchStatus }) {
  if (status === "matched") {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-600 border-0 dark:text-emerald-400 w-fit">
        ✓ Reconocido
      </Badge>
    );
  }
  if (status === "ambiguous") {
    return (
      <Badge className="bg-orange-500/10 text-orange-600 border-0 dark:text-orange-400 w-fit">
        ⚠ Elegí cuál corresponde
      </Badge>
    );
  }
  return (
    <Badge className="bg-destructive/10 text-destructive border-0 w-fit">
      ❌ No encontrado
    </Badge>
  );
}

/** Tarjeta por fila — mismo patrón mobile-first que ya usa BulkImageUpload (nunca tabla). */
function PreviewRowCard({
  row,
  products,
  onToggleIncluded,
  onResolve,
}: {
  row: PreviewRow;
  products: Product[];
  onToggleIncluded: () => void;
  onResolve: (product: ResolvableProduct) => void;
}) {
  const { format } = useHideMoney();
  const resolved = row.product !== null;

  return (
    <div className="rounded-lg border p-3 space-y-2" data-testid={`import-row-${row.sourceName}`}>
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={row.included}
          onCheckedChange={onToggleIncluded}
          disabled={!resolved}
          className="mt-0.5 shrink-0"
          aria-label={`Incluir ${row.sourceName}`}
          data-testid={`checkbox-import-include-${row.sourceName}`}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium break-words" title={row.sourceName}>
            {row.sourceName}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Cantidad: {row.quantity}</span>
            {row.quantity === 0 && <span className="text-amber-600 dark:text-amber-400">(sin stock en el archivo)</span>}
          </div>
          <StatusBadge status={row.status} />

          {resolved && (
            <div className="rounded-md bg-muted/50 p-2 text-xs">
              <p className="font-medium text-foreground break-words">{formatProductLabel(row.product!)}</p>
              <p className="text-muted-foreground">
                {format(row.product!.precio)} · {row.product!.puntos} pts
              </p>
            </div>
          )}

          {row.status === "ambiguous" && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Se encontraron varias coincidencias:</p>
              <div className="flex flex-wrap gap-1.5">
                {row.candidates.map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto py-1 text-xs whitespace-normal text-left"
                    onClick={() => onResolve(c)}
                    data-testid={`button-import-candidate-${c.id}`}
                  >
                    {formatProductLabel(c)}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {!resolved && (
            <ImportProductPicker products={products} onSelect={onResolve} />
          )}
        </div>
      </div>
    </div>
  );
}

export function ImportProductsDialog({ open, onOpenChange, products, onImport }: ImportProductsDialogProps) {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>("upload");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStage("upload");
    setRows([]);
    setSummary(null);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const processFile = async (file: File) => {
    setStage("uploading");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/products/import/parse", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const rawText = await res.text().catch(() => "");
        throw new Error(extractFriendlyErrorMessage(res.status, rawText));
      }
      const data = (await res.json()) as { summary: ImportSummary; matches: MatchResult[] };
      setSummary(data.summary);
      setRows(
        data.matches.map((m) => ({
          ...m,
          included: m.status === "matched" && m.quantity > 0,
        })),
      );
      setStage("preview");
    } catch (err) {
      toast({
        title: "No se pudo procesar el archivo",
        description: err instanceof Error ? err.message : "Intentá de nuevo.",
        variant: "destructive",
      });
      setStage("upload");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const resolveRow = (index: number, product: ResolvableProduct) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index
          ? {
              ...r,
              status: "matched",
              product: {
                id: product.id,
                producto: product.producto,
                variante: product.variante,
                seccion: product.seccion,
                precio: product.precio,
                puntos: product.puntos,
                imagen: product.imagen,
              },
              candidates: [],
              included: true,
            }
          : r,
      ),
    );
  };

  const toggleIncluded = (index: number) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, included: !r.included } : r)));
  };

  // Etapa 5, sección 19: no reconocidos primero, ambiguos después, reconocidos al final —
  // mismo criterio ya aplicado en BulkImageUpload (Etapa 2) para que lo que necesita
  // atención de la consultora nunca quede enterrado entre filas ya resueltas.
  const notFoundRows = useMemo(() => rows.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "not_found"), [rows]);
  const ambiguousRows = useMemo(() => rows.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "ambiguous"), [rows]);
  const matchedRows = useMemo(() => rows.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "matched"), [rows]);

  const includedCount = rows.filter((r) => r.included).length;
  const unresolvedCount = notFoundRows.length + ambiguousRows.length;

  const handleConfirm = () => {
    const lines: ImportedOrderLine[] = rows
      .filter((r) => r.included && r.product !== null)
      .map((r) => ({
        productId: r.product!.id,
        productName: r.product!.producto,
        category: r.product!.seccion,
        precio: r.product!.precio,
        quantity: r.quantity,
      }));
    onImport(lines);
    toast({ title: `${lines.length} producto${lines.length !== 1 ? "s" : ""} agregado${lines.length !== 1 ? "s" : ""} al pedido` });
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : handleClose())}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-3" data-testid="dialog-import-products">
        <DialogHeader>
          <DialogTitle>Importar productos desde archivo</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-1 -mx-1">
          {stage === "upload" && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
                dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50",
              )}
              data-testid="dropzone-import-products"
            >
              <div className="flex gap-2">
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="font-medium text-foreground">Arrastrá tu archivo acá</p>
              <p className="text-sm text-muted-foreground">o tocá para elegirlo — Excel (.xlsx), CSV o PDF, hasta 5MB</p>
              <p className="text-xs text-muted-foreground">
                Extraemos nombre y cantidad de cada producto — el precio y los puntos siempre salen de tu catálogo.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processFile(file);
                  e.target.value = "";
                }}
                data-testid="input-import-file"
              />
            </div>
          )}

          {stage === "uploading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Procesando archivo...</p>
            </div>
          )}

          {stage === "preview" && summary && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground" data-testid="text-import-summary">
                {summary.total} producto{summary.total !== 1 ? "s" : ""} detectado{summary.total !== 1 ? "s" : ""} ·{" "}
                {summary.matched} reconocido{summary.matched !== 1 ? "s" : ""} · {summary.ambiguous} ambiguo{summary.ambiguous !== 1 ? "s" : ""} ·{" "}
                {summary.notFound} no encontrado{summary.notFound !== 1 ? "s" : ""}
                {summary.zeroQuantity > 0 && ` · ${summary.zeroQuantity} con cantidad 0 (destildados por defecto)`}
              </p>

              {notFoundRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                    ❌ No encontrados ({notFoundRows.length})
                  </p>
                  {notFoundRows.map(({ r, i }) => (
                    <PreviewRowCard
                      key={i}
                      row={r}
                      products={products}
                      onToggleIncluded={() => toggleIncluded(i)}
                      onResolve={(p) => resolveRow(i, p)}
                    />
                  ))}
                </div>
              )}

              {ambiguousRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400">
                    ⚠ Ambiguos ({ambiguousRows.length})
                  </p>
                  {ambiguousRows.map(({ r, i }) => (
                    <PreviewRowCard
                      key={i}
                      row={r}
                      products={products}
                      onToggleIncluded={() => toggleIncluded(i)}
                      onResolve={(p) => resolveRow(i, p)}
                    />
                  ))}
                </div>
              )}

              {matchedRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    ✓ Reconocidos ({matchedRows.length})
                  </p>
                  {matchedRows.map(({ r, i }) => (
                    <PreviewRowCard
                      key={i}
                      row={r}
                      products={products}
                      onToggleIncluded={() => toggleIncluded(i)}
                      onResolve={(p) => resolveRow(i, p)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2 border-t pt-3">
          {stage === "preview" && (
            <>
              <Button type="button" variant="ghost" onClick={reset} data-testid="button-import-restart">
                <X className="h-4 w-4 mr-1.5" />
                Elegir otro archivo
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={handleConfirm}
                disabled={includedCount === 0}
                data-testid="button-import-confirm"
              >
                <Check className="h-4 w-4 mr-1.5" />
                Agregar {includedCount} al pedido
              </Button>
            </>
          )}
        </DialogFooter>
        {stage === "preview" && unresolvedCount > 0 && (
          <p className="text-xs text-center text-muted-foreground">
            {unresolvedCount} producto{unresolvedCount !== 1 ? "s" : ""} todavía sin resolver — no se van a agregar hasta que elijas a cuál corresponden.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
