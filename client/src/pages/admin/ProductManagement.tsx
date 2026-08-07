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
import { Label } from "@/components/ui/label";
import { Upload, FileSpreadsheet, Package, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { bulkProductSchema, type Consultant } from "@shared/schema";
import { z } from "zod";

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

function slugify(value: string): string {
  return stripDiacritics(value).replace(/\s+/g, "-").toLowerCase();
}

function normalizeHeader(raw: string): string {
  return stripDiacritics(raw).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeCategoryLabel(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed
    .toLowerCase()
    .split(" ")
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

const FIELD_ALIASES: Record<string, string[]> = {
  seccion: ["seccion", "categoria"],
  linea: ["linea", "coleccion"],
  producto: ["producto", "nombre", "nombreproducto"],
  variante: ["variante", "color", "tono"],
  codigo: ["codigo", "sku"],
  puntos: ["puntos", "pts"],
  precio: ["precio", "preciopublico", "precioventa", "precioventapublico"],
  unidades: ["unidades", "stock", "cantidad", "unidadesdisponibles"],
  imagen: ["imagen", "imagenurl", "foto", "urlimagen"],
  stockMinimo: ["stockminimo", "stockmin", "minimo"],
};

const REQUIRED_FIELDS = ["seccion", "linea", "producto", "precio"] as const;

const FIELD_LABELS: Record<string, string> = {
  seccion: "Categoría/Sección",
  linea: "Línea",
  producto: "Producto",
  precio: "Precio",
  unidades: "Unidades",
  codigo: "Código",
  variante: "Variante",
  puntos: "Puntos",
  imagen: "Imagen",
  stockMinimo: "Stock Mínimo",
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

  let autoCodigo = false;
  if (!codigo && seccion && linea && producto) {
    codigo = slugify(`${seccion}-${linea}-${producto}-${variante ?? "Estandar"}`);
    autoCodigo = true;
  }

  const unidadesRaw = get("unidades");
  const puntosRaw = get("puntos");
  const stockMinimoRaw = get("stockMinimo");
  const imagen = get("imagen") || undefined;

  if (!precioRaw) {
    return { rowNumber, error: `${FIELD_LABELS.precio}: falta el valor` };
  }

  const candidate = {
    seccion,
    linea,
    producto,
    precio: Number(precioRaw),
    unidades: unidadesRaw ? Number(unidadesRaw) : 0,
    codigo,
    variante,
    puntos: puntosRaw ? Number(puntosRaw) : undefined,
    imagen,
    stockMinimo: stockMinimoRaw ? Number(stockMinimoRaw) : undefined,
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

function buildPreview(rows: unknown[][]): { preview?: PreviewResult; error?: string } {
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) {
    return { error: "El archivo está vacío." };
  }

  const columnMap = resolveColumnMap(headerRow);
  const missing = REQUIRED_FIELDS.filter((field) => !(field in columnMap));
  if (missing.length > 0) {
    const labels = missing.map((f) => FIELD_LABELS[f]).join(", ");
    return { error: `No se encontraron las columnas: ${labels}. Revisá los encabezados del archivo.` };
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

function parseCsv(text: string): string[][] {
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
    } else if (char === ",") {
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

export default function ProductManagement() {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [targetConsultantId, setTargetConsultantId] = useState<string>("");

  const { data: consultants = [] } = useQuery<Consultant[]>({
    queryKey: ["/api/admin/consultants"],
  });

  const bulkMutation = useGuardedMutation({
    mutationFn: async ({ consultantId, products }: { consultantId: number; products: BulkProductInput[] }) => {
      const res = await apiRequest("POST", "/api/admin/products/bulk", { consultantId, products });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
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

  const processFile = useCallback(async (file: File) => {
    setSelectedFile(file);
    setUploadComplete(false);
    setParseError(null);
    setPreview(null);
    setIsParsing(true);

    try {
      const isCsv = file.name.toLowerCase().endsWith(".csv");
      const rows = isCsv ? parseCsv(await file.text()) : await readSheet(file);

      const { preview: result, error } = buildPreview(rows);
      if (error) {
        setParseError(error);
      } else if (result) {
        setPreview(result);
      }
    } catch (err) {
      setParseError(err instanceof Error ? `No se pudo leer el archivo: ${err.message}` : "No se pudo leer el archivo.");
    } finally {
      setIsParsing(false);
    }
  }, []);

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
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-product-management">
      <div>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <Package className="h-7 w-7 text-primary" />
          Carga Masiva de Productos
        </h1>
        <p className="text-muted-foreground mt-1">
          Sube un catálogo de productos para una consultora específica
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
            {preview && !uploadComplete ? (
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

                <div className="space-y-2">
                  <Label htmlFor="target-consultant">Consultora destino</Label>
                  <Select value={targetConsultantId} onValueChange={setTargetConsultantId}>
                    <SelectTrigger id="target-consultant" className="max-w-sm" data-testid="select-target-consultant">
                      <SelectValue placeholder="Elegí a qué consultora pertenece este catálogo" />
                    </SelectTrigger>
                    <SelectContent>
                      {consultants.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)} data-testid={`option-consultant-${c.id}`}>
                          {c.businessName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    onClick={() => bulkMutation.mutate({ consultantId: Number(targetConsultantId), products: preview.valid })}
                    disabled={preview.valid.length === 0 || !targetConsultantId || bulkMutation.isPending}
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
              {["Sección (o Categoría)", "Línea", "Producto", "Precio"].map((col) => (
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
              {["Código", "Variante", "Puntos", "Unidades (stock)", "Imagen (URL)", "Stock Mínimo"].map((col) => (
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
              Los encabezados admiten variantes razonables (con o sin tilde, "Categoría" en lugar de "Sección", etc.). Si un producto no trae código, se genera uno automáticamente. Vas a poder revisar una vista previa antes de confirmar la carga.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
