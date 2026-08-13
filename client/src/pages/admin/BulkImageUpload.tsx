import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronsUpDown,
  ImageOff,
  Loader2,
  Package,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { runWithConcurrency } from "@/lib/concurrency";
import {
  formatProductLabel,
  matchFileToProduct,
  validateImageFile,
  type CatalogProductRef,
  type MatchMethod,
  type MatchStatus,
} from "@/lib/imageMatching";

interface GlobalProduct {
  id: number;
  seccion: string;
  linea: string | null;
  producto: string;
  variante: string;
  codigo: string;
  puntos: number;
  precio: number;
  imagen: string | null;
}

type UploadState = "idle" | "uploading" | "success" | "error" | "skipped";

interface Row {
  key: string;
  file: File;
  previewUrl: string;
  invalidReason: string | null;
  matchStatus: MatchStatus | "invalido";
  method: MatchMethod | null;
  productId: number | null;
  candidates: CatalogProductRef[];
  uploadState: UploadState;
  uploadError: string | null;
}

const CONCURRENCY_LIMIT = 4;

function makeKey(file: File): string {
  return `${file.name}__${file.size}__${file.lastModified}__${Math.random().toString(36).slice(2)}`;
}

export default function BulkImageUpload() {
  const { data: products = [], isLoading } = useQuery<GlobalProduct[]>({
    queryKey: ["/api/admin/products"],
  });
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [rows, setRows] = useState<Row[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const catalogRefs: CatalogProductRef[] = products;
    const newRows: Row[] = Array.from(files).map((file) => {
      const validation = validateImageFile(file);
      if (!validation.valid) {
        return {
          key: makeKey(file),
          file,
          previewUrl: URL.createObjectURL(file),
          invalidReason: validation.reason,
          matchStatus: "invalido",
          method: null,
          productId: null,
          candidates: [],
          uploadState: "idle",
          uploadError: null,
        };
      }
      const match = matchFileToProduct(file.name, catalogRefs);
      return {
        key: makeKey(file),
        file,
        previewUrl: URL.createObjectURL(file),
        invalidReason: null,
        matchStatus: match.status,
        method: match.method,
        productId: match.productId,
        candidates: match.candidates,
        uploadState: "idle",
        uploadError: null,
      };
    });
    setRows((prev) => [...prev, ...newRows]);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (isUploading) return;
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const removeRow = (key: string) => {
    setRows((prev) => {
      const row = prev.find((r) => r.key === key);
      if (row) URL.revokeObjectURL(row.previewUrl);
      return prev.filter((r) => r.key !== key);
    });
  };

  const clearAll = () => {
    rows.forEach((r) => URL.revokeObjectURL(r.previewUrl));
    setRows([]);
  };

  const assignProduct = (key: string, productId: number) => {
    setRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? {
              ...r,
              matchStatus: "reconocida",
              method: "manual",
              productId,
              candidates: productsById.has(productId) ? [productsById.get(productId)!] : [],
            }
          : r,
      ),
    );
  };

  const validRows = rows.filter((r) => r.matchStatus !== "invalido");
  const invalidCount = rows.length - validRows.length;
  const reconocidas = validRows.filter((r) => r.matchStatus === "reconocida");
  const sinCoincidencia = validRows.filter((r) => r.matchStatus === "sin_coincidencia");
  const ambiguas = validRows.filter((r) => r.matchStatus === "ambigua");
  const yaTienenImagen = reconocidas.filter((r) => r.productId !== null && productsById.get(r.productId)?.imagen);
  const productosNuevos = reconocidas.length - yaTienenImagen.length;

  const canConfirm =
    !isUploading && validRows.length > 0 && validRows.every((r) => r.productId !== null);

  const hasErrors = rows.some((r) => r.uploadState === "error");
  const uploadedCount = rows.filter((r) => r.uploadState === "success").length;
  const skippedCount = rows.filter((r) => r.uploadState === "skipped").length;
  const errorCount = rows.filter((r) => r.uploadState === "error").length;
  const totalQueued = rows.filter((r) => r.uploadState !== "idle").length;
  const processedCount = rows.filter((r) => ["success", "error", "skipped"].includes(r.uploadState)).length;
  const attempted = rows.filter((r) => r.uploadState !== "idle");
  const finished = attempted.length > 0 && attempted.every((r) => r.uploadState !== "uploading") && !isUploading;

  async function uploadOne(row: Row): Promise<void> {
    if (row.productId === null) return;
    const alreadyHasImage = !!productsById.get(row.productId)?.imagen;
    if (alreadyHasImage && !replaceExisting) {
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, uploadState: "skipped" } : r)));
      return;
    }

    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, uploadState: "uploading" } : r)));

    try {
      const formData = new FormData();
      formData.append("image", row.file);
      const res = await fetch(`/api/admin/products/${row.productId}/image`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error ${res.status} al subir la imagen`);
      }
      const updated = await res.json();
      productsById.set(updated.id, updated);
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, uploadState: "success", uploadError: null } : r)));
    } catch (err) {
      setRows((prev) =>
        prev.map((r) =>
          r.key === row.key
            ? { ...r, uploadState: "error", uploadError: err instanceof Error ? err.message : "Error desconocido" }
            : r,
        ),
      );
    }
  }

  async function runUpload(target: Row[]) {
    setIsUploading(true);
    await runWithConcurrency(target, CONCURRENCY_LIMIT, uploadOne);
    setIsUploading(false);
    queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
    queryClient.invalidateQueries({ queryKey: ["/api/products"] });
  }

  const handleConfirm = () => {
    if (!canConfirm) return;
    runUpload(validRows);
  };

  const handleRetry = () => {
    const failed = rows.filter((r) => r.uploadState === "error");
    if (failed.length === 0) return;
    runUpload(failed);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto" data-testid="page-bulk-image-upload">
      <div className="flex items-center gap-3">
        <Link href="/admin/productos">
          <Button variant="ghost" size="icon" data-testid="button-back-to-catalog">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Upload className="h-6 w-6 text-primary" />
            Carga masiva de imágenes
          </h1>
          <p className="text-sm text-muted-foreground">
            Arrastrá o seleccioná las imágenes de los productos del catálogo global
          </p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!isUploading) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors",
              isUploading ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary/50",
              dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25",
            )}
            data-testid="dropzone-images"
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-foreground">Arrastrá tus imágenes acá</p>
            <p className="text-sm text-muted-foreground">
              o hacé clic para elegirlas — JPG, JPEG, PNG o WEBP, hasta 5MB cada una
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Nombrá cada archivo con el ID del producto, ej: <span className="font-mono">47.jpg</span>
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
              data-testid="input-bulk-images"
            />
          </div>

          {rows.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex flex-wrap gap-3 text-muted-foreground">
                <span data-testid="text-total-files">
                  <strong className="text-foreground">{rows.length}</strong> archivos seleccionados
                </span>
                <span className="text-emerald-600 dark:text-emerald-400">{validRows.length} válidos</span>
                {invalidCount > 0 && <span className="text-destructive">{invalidCount} inválidos</span>}
              </div>
              <Button variant="ghost" size="sm" onClick={clearAll} disabled={isUploading} data-testid="button-clear-all">
                <Trash2 className="h-4 w-4 mr-1" /> Vaciar todo
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <Checkbox
              id="replace-existing"
              checked={replaceExisting}
              onCheckedChange={(v) => setReplaceExisting(v === true)}
              disabled={isUploading}
              data-testid="checkbox-replace-existing"
            />
            <label htmlFor="replace-existing" className="text-sm text-foreground cursor-pointer">
              Reemplazar imágenes existentes (si está desactivado, esos productos se omiten)
            </label>
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Previsualización</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="p-2 font-medium">Imagen</th>
                      <th className="p-2 font-medium">Archivo</th>
                      <th className="p-2 font-medium">Producto asignado</th>
                      <th className="p-2 font-medium">Sección</th>
                      <th className="p-2 font-medium">Matching</th>
                      <th className="p-2 font-medium">Estado</th>
                      <th className="p-2 font-medium w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <RowView
                        key={row.key}
                        row={row}
                        products={products}
                        productsById={productsById}
                        onAssign={assignProduct}
                        onRemove={removeRow}
                        disabled={isUploading}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {!isUploading && totalQueued === 0 && (
            <Card className="shadow-sm bg-muted/40">
              <CardContent className="pt-6 space-y-2 text-sm">
                <p className="font-medium text-foreground">
                  {validRows.length} archivos listos para revisar
                </p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>✓ {reconocidas.length} reconocidos</li>
                  {sinCoincidencia.length > 0 && <li>⚠ {sinCoincidencia.length} sin coincidencia</li>}
                  {ambiguas.length > 0 && <li>⚠ {ambiguas.length} ambiguos</li>}
                  {invalidCount > 0 && <li>✕ {invalidCount} inválidos (no se van a subir)</li>}
                </ul>
                <ul className="space-y-1 text-muted-foreground">
                  <li>{productosNuevos} productos nuevos</li>
                  {yaTienenImagen.length > 0 && <li>{yaTienenImagen.length} productos ya tienen imagen</li>}
                </ul>
                <p className="text-muted-foreground pt-1">
                  Revisá las coincidencias antes de confirmar. Las imágenes no se suben hasta presionar
                  "Confirmar carga".
                </p>
                <Button onClick={handleConfirm} disabled={!canConfirm} data-testid="button-confirm-bulk-upload">
                  Confirmar carga
                </Button>
                {!canConfirm && validRows.length > 0 && (
                  <p className="text-xs text-destructive">
                    Asigná un producto a cada archivo (o quitalo de la lista) antes de confirmar.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {totalQueued > 0 && (
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">{isUploading ? "Subiendo imágenes..." : "Carga completada"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>
                      {processedCount} / {validRows.length}
                    </span>
                    {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
                  </div>
                  <Progress value={(processedCount / Math.max(validRows.length, 1)) * 100} data-testid="progress-bulk-upload" />
                </div>

                {finished && (
                  <div className="space-y-2 text-sm">
                    <p className="font-medium text-foreground" data-testid="text-upload-summary">
                      {uploadedCount} imágenes subidas correctamente
                      {skippedCount > 0 ? ` · ${skippedCount} omitidas (ya tenían imagen)` : ""}
                      {errorCount > 0 ? ` · ${errorCount} con error` : ""}
                    </p>
                    {hasErrors && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                        {rows
                          .filter((r) => r.uploadState === "error")
                          .map((r) => (
                            <p key={r.key} className="text-xs text-destructive">
                              <strong>{r.file.name}</strong>
                              {r.productId ? ` — ${formatProductLabel(productsById.get(r.productId)!)}` : ""}: {r.uploadError}
                            </p>
                          ))}
                        <Button variant="outline" size="sm" onClick={handleRetry} data-testid="button-retry-errors">
                          <RotateCcw className="h-4 w-4 mr-1" /> Reintentar errores
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Cargando catálogo...</p>}
    </div>
  );
}

function RowView({
  row,
  products,
  productsById,
  onAssign,
  onRemove,
  disabled,
}: {
  row: Row;
  products: GlobalProduct[];
  productsById: Map<number, GlobalProduct>;
  onAssign: (key: string, productId: number) => void;
  onRemove: (key: string) => void;
  disabled: boolean;
}) {
  const assignedProduct = row.productId !== null ? productsById.get(row.productId) ?? null : null;
  const alreadyHasImage = !!assignedProduct?.imagen;

  return (
    <tr className="border-b last:border-0" data-testid={`row-bulk-image-${row.key}`}>
      <td className="p-2">
        <div className="h-12 w-12 overflow-hidden rounded-md border bg-muted flex items-center justify-center shrink-0">
          {row.invalidReason ? (
            <ImageOff className="h-5 w-5 text-destructive" />
          ) : (
            <img src={row.previewUrl} alt={row.file.name} className="h-full w-full object-cover" />
          )}
        </div>
      </td>
      <td className="p-2 max-w-[160px]">
        <p className="truncate font-mono text-xs" title={row.file.name}>
          {row.file.name}
        </p>
        {row.invalidReason && <p className="text-xs text-destructive">{row.invalidReason}</p>}
      </td>
      <td className="p-2 min-w-[220px]">
        {!row.invalidReason && <ProductPicker products={products} value={row.productId} onSelect={(id) => onAssign(row.key, id)} disabled={disabled} />}
      </td>
      <td className="p-2 text-muted-foreground">{assignedProduct?.seccion ?? "—"}</td>
      <td className="p-2">{row.method && <MethodBadge method={row.method} />}</td>
      <td className="p-2">
        <StatusBadge row={row} alreadyHasImage={alreadyHasImage} />
      </td>
      <td className="p-2">
        <Button variant="ghost" size="icon" onClick={() => onRemove(row.key)} disabled={disabled} data-testid={`button-remove-row-${row.key}`}>
          <X className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}

function MethodBadge({ method }: { method: MatchMethod }) {
  const label = method === "id" ? "ID" : method === "nombre" ? "Nombre" : "Manual";
  return (
    <Badge variant="outline" className="text-xs font-normal">
      {label}
    </Badge>
  );
}

function StatusBadge({ row, alreadyHasImage }: { row: Row; alreadyHasImage: boolean }) {
  if (row.uploadState === "uploading") {
    return (
      <Badge className="bg-blue-500/10 text-blue-600 border-0 dark:text-blue-400">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Subiendo
      </Badge>
    );
  }
  if (row.uploadState === "success") {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-600 border-0 dark:text-emerald-400">
        <Check className="h-3 w-3 mr-1" /> Completada
      </Badge>
    );
  }
  if (row.uploadState === "error") {
    return (
      <Badge className="bg-destructive/10 text-destructive border-0">
        <X className="h-3 w-3 mr-1" /> Error
      </Badge>
    );
  }
  if (row.uploadState === "skipped") {
    return (
      <Badge variant="secondary" className="text-xs font-normal">
        Omitida (ya tenía imagen)
      </Badge>
    );
  }

  if (row.matchStatus === "invalido") {
    return (
      <Badge className="bg-destructive/10 text-destructive border-0">
        🔴 Archivo inválido
      </Badge>
    );
  }
  if (row.matchStatus === "sin_coincidencia") {
    return (
      <Badge className="bg-amber-500/10 text-amber-600 border-0 dark:text-amber-400">
        🟡 Sin coincidencia
      </Badge>
    );
  }
  if (row.matchStatus === "ambigua") {
    return (
      <Badge className="bg-orange-500/10 text-orange-600 border-0 dark:text-orange-400">
        🟠 Ambigua
      </Badge>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Badge className="bg-emerald-500/10 text-emerald-600 border-0 dark:text-emerald-400 w-fit">
        🟢 Reconocida
      </Badge>
      {alreadyHasImage && (
        <Badge className="bg-sky-500/10 text-sky-600 border-0 dark:text-sky-400 w-fit">
          🔵 Ya tiene imagen
        </Badge>
      )}
    </div>
  );
}

function ProductPicker({
  products,
  value,
  onSelect,
  disabled,
}: {
  products: GlobalProduct[];
  value: number | null;
  onSelect: (id: number) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = value !== null ? products.find((p) => p.id === value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal"
          data-testid="button-product-picker"
        >
          {selected ? (
            <span className="truncate text-left">
              <span className="text-muted-foreground">#{selected.id}</span> {formatProductLabel(selected)}
            </span>
          ) : (
            <span className="text-muted-foreground">Elegir producto...</span>
          )}
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0">
        <Command>
          <CommandInput placeholder="Buscar por nombre o ID..." data-testid="input-product-picker-search" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.id} ${p.producto} ${p.variante}`}
                  onSelect={() => {
                    onSelect(p.id);
                    setOpen(false);
                  }}
                  data-testid={`option-product-${p.id}`}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                  <Package className="mr-2 h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">
                    <span className="text-muted-foreground">#{p.id}</span> {formatProductLabel(p)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
