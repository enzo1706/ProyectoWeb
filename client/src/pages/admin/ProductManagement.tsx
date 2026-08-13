import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { readSheet } from "read-excel-file/browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Upload, FileSpreadsheet, Package, CheckCircle2, AlertTriangle, X, ImagePlus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { bulkProductSchema } from "@shared/schema";
import { slugify } from "@shared/slug";
import { z } from "zod";

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

type BulkProductInput = z.infer<typeof bulkProductSchema>[number];

interface ParsedRow {
  rowNumber: number;
  data?: BulkProductInput;
  error?: string;
  autoCodigo?: boolean;
}

interface PreviewResult {
  valid: BulkProductInput[];
  invalid: { rowNumber: number; error: string }[];
  autoCodigoCount: number;
}

const COMBINING_MARKS_START = 0x0300;
const COMBINING_MARKS_END = 0x036f;

function stripDiacritics(value: string): string {
  return Array.from(value.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < COMBINING_MARKS_START || code > COMBINING_MARKS_END;
    })
    .join("");
}

function normalizeHeader(raw: string): string {
  return stripDiacritics(raw).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Solo trim/colapso de espacios — NO recapitalizar. Las categorías reales de un catálogo
// (ej. "TimeWise") pueden tener mayúsculas internas intencionales que hay que conservar tal cual.
function normalizeCategoryLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

// Solo catálogo — sin stock: el admin carga el catálogo GLOBAL (mismo para todas las
// consultoras), el stock lo configura después cada una por separado.
const FIELD_ALIASES: Record<string, string[]> = {
  seccion: ["seccion", "categoria", "categorias"],
  linea: ["linea", "coleccion"],
  producto: ["producto", "productos", "nombre", "nombreproducto"],
  variante: ["variante", "color", "tono", "tonos"],
  codigo: ["codigo", "sku"],
  puntos: ["puntos", "pts"],
  precio: ["precio", "preciopublico", "precioventa", "precioventapublico", "precioventaalpublico"],
  imagen: ["imagen", "imagenurl", "foto", "urlimagen", "fotodelproducto"],
};

// "linea" quedó afuera: el schema ya la acepta vacía — varios catálogos reales no tienen
// un segundo nivel de categoría, y no vamos a bloquear la carga por eso.
const REQUIRED_FIELDS = ["seccion", "producto", "precio"] as const;

const FIELD_LABELS: Record<string, string> = {
  seccion: "Categoría/Sección",
  linea: "Línea",
  producto: "Producto",
  precio: "Precio",
  codigo: "Código",
  variante: "Variante",
  puntos: "Puntos",
  imagen: "Imagen",
};

function resolveColumnMap(headerRow: unknown[]): Record<string, number> {
  const normalizedHeaders = headerRow.map((h) => normalizeHeader(String(h ?? "")));
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const idx = normalizedHeaders.findIndex((h) => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function parseRow(row: unknown[], columnMap: Record<string, number>, rowNumber: number): ParsedRow {
  const get = (field: string): string => {
    const idx = columnMap[field];
    if (idx === undefined) return "";
    const value = row[idx];
    if (value === null || value === undefined) return "";
    return String(value).trim();
  };

  const seccionRaw = get("seccion");
  const linea = get("linea");
  const producto = get("producto");
  const precioRaw = get("precio").replace(",", ".");
  const variante = get("variante") || undefined;
  let codigo = get("codigo") || undefined;

  const seccion = seccionRaw ? normalizeCategoryLabel(seccionRaw) : "";

  // `linea` es opcional — no bloquea la generación de código (varios catálogos reales no la traen).
  let autoCodigo = false;
  if (!codigo && seccion && producto) {
    codigo = slugify(`${seccion}-${linea}-${producto}-${variante ?? "Estandar"}`);
    autoCodigo = true;
  }

  const puntosRaw = get("puntos");
  const imagen = get("imagen") || undefined;

  if (!precioRaw) {
    return { rowNumber, error: `${FIELD_LABELS.precio}: falta el valor` };
  }

  const candidate = {
    seccion,
    linea: linea || undefined,
    producto,
    // El archivo trae el precio en pesos enteros; toda la app guarda montos en centavos
    // (mismo criterio que el resto de los inputs de dinero, ej. Configuración/costo de envío).
    precio: Math.round(Number(precioRaw) * 100),
    codigo,
    variante,
    puntos: puntosRaw ? Number(puntosRaw) : undefined,
    imagen,
  };

  const result = bulkProductSchema.element.safeParse(candidate);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${FIELD_LABELS[String(issue.path[0])] ?? issue.path[0]}: ${issue.message}`)
      .join("; ");
    return { rowNumber, error: message || "Datos inválidos" };
  }

  return { rowNumber, autoCodigo, data: result.data };
}

interface BuildPreviewResult {
  preview?: PreviewResult;
  error?: string;
  /** Se devuelve cuando falta mapear manualmente alguna columna obligatoria. */
  headerRow?: unknown[];
  missingFields?: string[];
}

function buildPreview(rows: unknown[][], manualColumnMap: Record<string, number> = {}): BuildPreviewResult {
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) {
    return { error: "El archivo está vacío." };
  }

  const columnMap = { ...resolveColumnMap(headerRow), ...manualColumnMap };
  const missing = REQUIRED_FIELDS.filter((field) => !(field in columnMap));
  if (missing.length > 0) {
    return { headerRow, missingFields: missing };
  }

  const nonEmptyRows = dataRows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));

  const valid: BulkProductInput[] = [];
  const invalid: { rowNumber: number; error: string }[] = [];
  let autoCodigoCount = 0;

  nonEmptyRows.forEach((row, index) => {
    const rowNumber = index + 2; // fila 1 = encabezado
    const parsed = parseRow(row, columnMap, rowNumber);
    if (parsed.data) {
      valid.push(parsed.data);
      if (parsed.autoCodigo) autoCodigoCount++;
    } else {
      invalid.push({ rowNumber, error: parsed.error ?? "Datos inválidos" });
    }
  });

  return { preview: { valid, invalid, autoCodigoCount } };
}

/** Excel en configuración regional Español suele exportar CSV con `;` (usa `,` como separador
 * decimal). Se cuenta cuál aparece más veces en la primera línea para no asumir siempre coma. */
function detectDelimiter(text: string): "," | ";" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const semicolonCount = (firstLine.match(/;/g) ?? []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseCsv(text: string, delimiter: "," | ";" = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function ProductImageDialog({
  product,
  open,
  onOpenChange,
}: {
  product: GlobalProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleClose = () => {
    setFile(null);
    setPreviewUrl(null);
    onOpenChange(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setPreviewUrl(selected ? URL.createObjectURL(selected) : null);
  };

  const uploadMutation = useGuardedMutation({
    mutationFn: async () => {
      if (!product || !file) throw new Error("Elegí un archivo primero");
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch(`/api/admin/products/${product.id}/image`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "No se pudo subir la imagen");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Imagen actualizada" });
      handleClose();
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo subir la imagen", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useGuardedMutation({
    mutationFn: async () => {
      if (!product) return;
      const res = await apiRequest("DELETE", `/api/admin/products/${product.id}/image`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Imagen quitada" });
      handleClose();
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo quitar la imagen", description: err.message, variant: "destructive" });
    },
  });

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-product-image">
        <DialogHeader>
          <DialogTitle>{product.producto}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-lg border bg-muted">
            {previewUrl || product.imagen ? (
              <img
                src={previewUrl ?? product.imagen ?? undefined}
                alt={product.producto}
                className="h-full w-full object-cover"
              />
            ) : (
              <Package className="h-10 w-10 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-image-file">Imagen (JPG, PNG o WebP, hasta 5MB)</Label>
            <Input
              id="product-image-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              data-testid="input-product-image"
            />
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2 border-t pt-4">
          {product.imagen && (
            <Button
              type="button"
              variant="outline"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
              data-testid="button-remove-image"
            >
              Quitar imagen
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => uploadMutation.mutate()}
            disabled={!file || uploadMutation.isPending}
            data-testid="button-upload-image"
          >
            {uploadMutation.isPending ? "Subiendo..." : "Subir imagen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GlobalCatalogList() {
  const { data: products = [], isLoading } = useQuery<GlobalProduct[]>({
    queryKey: ["/api/admin/products"],
  });
  const [selected, setSelected] = useState<GlobalProduct | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <Card className="shadow-sm" data-testid="card-global-catalog">
      <CardHeader>
        <CardTitle className="text-lg text-foreground">Catálogo global</CardTitle>
        <p className="text-sm text-muted-foreground">
          Productos ya cargados — agregá o cambiá la imagen de cada uno.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="empty-global-catalog">
            Todavía no hay productos globales cargados.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg border p-2"
                data-testid={`row-global-product-${p.id}`}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  {p.imagen ? (
                    <img src={p.imagen} alt={p.producto} className="h-full w-full object-cover" />
                  ) : (
                    <Package className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.producto}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{p.codigo}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelected(p);
                    setDialogOpen(true);
                  }}
                  data-testid={`button-manage-image-${p.id}`}
                >
                  <ImagePlus className="h-4 w-4 mr-1" />
                  {p.imagen ? "Cambiar" : "Agregar"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <ProductImageDialog product={selected} open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  );
}

export default function ProductManagement() {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [rawRows, setRawRows] = useState<unknown[][] | null>(null);
  const [mappingInfo, setMappingInfo] = useState<{ headerRow: unknown[]; missingFields: string[] } | null>(null);
  const [manualColumnMap, setManualColumnMap] = useState<Record<string, number>>({});

  const bulkMutation = useGuardedMutation({
    mutationFn: async ({ products }: { products: BulkProductInput[] }) => {
      const res = await apiRequest("POST", "/api/admin/products/bulk", { products });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
      setUploadComplete(true);
      setSelectedFile(null);
      setPreview(null);
      toast({
        title: "Catálogo cargado",
        description: `${data.count} productos procesados correctamente.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error en la carga", description: error.message, variant: "destructive" });
    },
  });

  const applyPreview = useCallback((rows: unknown[][], manualMap: Record<string, number>) => {
    const result = buildPreview(rows, manualMap);
    if (result.error) {
      setParseError(result.error);
      setMappingInfo(null);
    } else if (result.missingFields && result.missingFields.length > 0) {
      setMappingInfo({ headerRow: result.headerRow!, missingFields: result.missingFields });
      setPreview(null);
    } else if (result.preview) {
      setPreview(result.preview);
      setMappingInfo(null);
    }
  }, []);

  const processFile = useCallback(
    async (file: File) => {
      setSelectedFile(file);
      setUploadComplete(false);
      setParseError(null);
      setPreview(null);
      setMappingInfo(null);
      setManualColumnMap({});
      setRawRows(null);
      setIsParsing(true);

      try {
        const isCsv = file.name.toLowerCase().endsWith(".csv");
        let rows: unknown[][];
        if (isCsv) {
          const rawText = await file.text();
          const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
          rows = parseCsv(text, detectDelimiter(text));
        } else {
          rows = await readSheet(file);
        }
        setRawRows(rows);
        applyPreview(rows, {});
      } catch (err) {
        setParseError(err instanceof Error ? `No se pudo leer el archivo: ${err.message}` : "No se pudo leer el archivo.");
      } finally {
        setIsParsing(false);
      }
    },
    [applyPreview],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const reset = () => {
    setSelectedFile(null);
    setParseError(null);
    setPreview(null);
    setUploadComplete(false);
    setMappingInfo(null);
    setManualColumnMap({});
    setRawRows(null);
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-product-management">
      <div>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <Package className="h-7 w-7 text-primary" />
          Carga Masiva de Productos
        </h1>
        <p className="text-muted-foreground mt-1">
          Sube el catálogo global de productos — queda visible para todas las consultoras
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">
              Zona de Carga
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mappingInfo ? (
              <div className="space-y-4" data-testid="mapping-panel">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground mb-1">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    No reconocimos automáticamente algunas columnas obligatorias
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Elegí manualmente qué columna del archivo corresponde a cada campo.
                  </p>
                </div>

                <div className="space-y-3">
                  {mappingInfo.missingFields.map((field) => (
                    <div key={field} className="space-y-1.5">
                      <Label>{FIELD_LABELS[field]}</Label>
                      <Select
                        value={manualColumnMap[field] !== undefined ? String(manualColumnMap[field]) : ""}
                        onValueChange={(v) => setManualColumnMap((prev) => ({ ...prev, [field]: Number(v) }))}
                      >
                        <SelectTrigger data-testid={`select-map-${field}`}>
                          <SelectValue placeholder="Elegí la columna del archivo" />
                        </SelectTrigger>
                        <SelectContent>
                          {mappingInfo.headerRow.map((h, i) => (
                            <SelectItem key={i} value={String(i)}>
                              {String(h ?? `Columna ${i + 1}`) || `Columna ${i + 1}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    onClick={() => rawRows && applyPreview(rawRows, manualColumnMap)}
                    disabled={mappingInfo.missingFields.some((f) => manualColumnMap[f] === undefined)}
                    data-testid="button-confirm-mapping"
                  >
                    Confirmar mapeo
                  </Button>
                  <Button variant="outline" onClick={reset} data-testid="button-cancel-mapping">
                    Elegir otro archivo
                  </Button>
                </div>
              </div>
            ) : preview && !uploadComplete ? (
              <div className="space-y-4" data-testid="preview-panel">
                <div className="flex items-center gap-3 rounded-lg border bg-muted p-4">
                  <CheckCircle2 className="h-8 w-8 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {preview.valid.length} producto{preview.valid.length !== 1 ? "s" : ""} listo{preview.valid.length !== 1 ? "s" : ""} para cargar
                    </p>
                    {preview.autoCodigoCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {preview.autoCodigoCount} sin código en el archivo — se generó uno automáticamente
                      </p>
                    )}
                  </div>
                </div>

                {preview.invalid.length > 0 && (
                  <div
                    className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"
                    data-testid="preview-errors"
                  >
                    <p className="flex items-center gap-2 text-sm font-medium text-destructive mb-2">
                      <AlertTriangle className="h-4 w-4" />
                      {preview.invalid.length} fila{preview.invalid.length !== 1 ? "s" : ""} con problemas (no se van a cargar)
                    </p>
                    <ul className="space-y-1 max-h-40 overflow-y-auto text-xs text-muted-foreground">
                      {preview.invalid.map((row) => (
                        <li key={row.rowNumber}>
                          Fila {row.rowNumber}: {row.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    onClick={() => bulkMutation.mutate({ products: preview.valid })}
                    disabled={preview.valid.length === 0 || bulkMutation.isPending}
                    data-testid="button-confirm-upload"
                  >
                    {bulkMutation.isPending ? "Cargando..." : "Confirmar carga"}
                  </Button>
                  <Button variant="outline" onClick={reset} data-testid="button-pick-another-file">
                    Elegir otro archivo
                  </Button>
                </div>
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-6 sm:p-12 transition-colors",
                  isDragging
                    ? "border-primary bg-primary/10"
                    : "border-muted-foreground/30 bg-muted/30 hover:border-primary/50 hover:bg-primary/5",
                )}
                data-testid="dropzone-products"
              >
                {isParsing ? (
                  <>
                    <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                    <p className="text-sm font-medium text-foreground">Leyendo archivo...</p>
                    {selectedFile && <p className="text-xs text-muted-foreground">{selectedFile.name}</p>}
                  </>
                ) : parseError ? (
                  <>
                    <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
                      <X className="h-7 w-7 text-destructive" />
                    </div>
                    <div className="text-center space-y-1 max-w-md">
                      <p className="text-sm font-medium text-destructive">No se pudo procesar el archivo</p>
                      <p className="text-xs text-muted-foreground">{parseError}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={reset} data-testid="button-retry-upload">
                      Elegir otro archivo
                    </Button>
                  </>
                ) : uploadComplete ? (
                  <>
                    <CheckCircle2 className="h-12 w-12 text-primary" />
                    <p className="text-sm font-medium text-foreground">
                      ¡Carga completada!
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={reset}
                    >
                      Cargar otro archivo
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                      <Upload className="h-7 w-7 text-primary" />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        Arrastra tu archivo aquí
                      </p>
                      <p className="text-xs text-muted-foreground">
                        o haz clic para seleccionar (.csv, .xlsx)
                      </p>
                    </div>
                    <label>
                      <input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        className="hidden"
                        onChange={handleFileSelect}
                        data-testid="input-file-products"
                      />
                      <Button asChild variant="default" className="cursor-pointer">
                        <span>
                          <FileSpreadsheet className="h-4 w-4 mr-2 inline" />
                          Seleccionar Archivo
                        </span>
                      </Button>
                    </label>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">
              Formato Esperado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Columnas obligatorias:
            </p>
            <ul className="space-y-2">
              {["Sección (o Categoría)", "Producto", "Precio"].map((col) => (
                <li
                  key={col}
                  className="flex items-center gap-2 text-foreground"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {col}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              Columnas opcionales:
            </p>
            <ul className="space-y-2">
              {["Línea", "Código", "Variante", "Puntos", "Imagen (URL)"].map((col) => (
                <li
                  key={col}
                  className="flex items-center gap-2 text-muted-foreground"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                  {col}
                </li>
              ))}
            </ul>
            <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground border">
              Los encabezados admiten variantes razonables (con o sin tilde, "Categoría" en lugar de "Sección", etc.). Si un producto no trae código, se genera uno automáticamente. Vas a poder revisar una vista previa antes de confirmar la carga. El catálogo queda visible para todas las consultoras — cada una carga su propio stock después, desde Productos.
            </div>
          </CardContent>
        </Card>
      </div>

      <GlobalCatalogList />
    </div>
  );
}
