import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClientCard, type Client } from "@/components/ClientCard";
import { ClientDialog } from "@/components/ClientDialog";
import { ClientDetailSheet } from "@/components/ClientDetailSheet";
import { NewSaleDialog } from "@/components/NewSaleDialog";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Plus, Search, ChevronLeft, ChevronRight, Filter, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";
import { cn } from "@/lib/utils";
import type { InsertClient, Product } from "@shared/schema";
import { type ClientListFilter, CLIENT_LIST_FILTER_LABELS, DEFAULT_CLIENTS_PAGE_SIZE } from "@shared/clientFilters";

// Prompt 9, punto 2 — las 3 opciones del botón "Filtros" (nunca "todas", que es "sin filtro").
const FILTER_OPTIONS: ClientListFilter[] = ["pendiente_pago", "no_compran_hace", "cumplen_anios"];

// Espejo de PaginatedClients (server/storage.ts) — contrato de GET /api/clients en modo
// paginado (con `page` presente). Mismo criterio que Reportes.tsx para tipos de respuesta.
interface PaginatedClientsResponse {
  items: Client[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  totalRevenue: number;
}

export default function Clientas() {
  const { toast } = useToast();
  const { format } = useHideMoney();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [saleDialogOpen, setSaleDialogOpen] = useState(false);
  const [filter, setFilter] = useState<ClientListFilter>("todas");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [saleClient, setSaleClient] = useState<Client | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  // Volver a página 1 cada vez que cambia el criterio (búsqueda o filtro) — nunca quedar
  // parada en la página 5 de un resultado que ahora solo tiene 2 páginas.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filter]);

  const { data, isLoading, isError } = useQuery<PaginatedClientsResponse>({
    queryKey: ["/api/clients", debouncedSearch, filter, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(DEFAULT_CLIENTS_PAGE_SIZE),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (filter !== "todas") params.set("filter", filter);
      const res = await apiRequest("GET", `/api/clients?${params.toString()}`);
      return res.json();
    },
  });

  const clients = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const totalRevenue = data?.totalRevenue ?? 0;

  const { data: products = [] } = useQuery<Product[]>({ queryKey: ["/api/products"] });

  const createMutation = useGuardedMutation({
    mutationFn: async (data: Partial<InsertClient>) => {
      const res = await apiRequest("POST", "/api/clients", data);
      return res.json() as Promise<Client>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Clienta creada correctamente" });
      setDialogOpen(false);
      setEditingClient(null);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo crear la clienta", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useGuardedMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertClient> }) => {
      const res = await apiRequest("PATCH", `/api/clients/${id}`, data);
      return res.json() as Promise<Client>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Clienta actualizada correctamente" });
      setDialogOpen(false);
      setEditingClient(null);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo actualizar la clienta", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = (client: Omit<Client, "id" | "totalPurchases" | "lastPurchase" | "consultantId">) => {
    if (editingClient) {
      updateMutation.mutate({ id: editingClient.id, data: client });
    } else {
      createMutation.mutate(client);
    }
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setDialogOpen(true);
    setDetailOpen(false);
  };

  const handleClientClick = (client: Client) => {
    setSelectedClient(client);
    setDetailOpen(true);
  };

  const handleNewClient = () => {
    setEditingClient(null);
    setDialogOpen(true);
  };

  const handleNewSale = (client: Client) => {
    setSaleClient(client);
    setSaleDialogOpen(true);
    setDetailOpen(false);
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-clientas">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Clientas</h1>
          <p className="text-muted-foreground">
            {isError
              ? "No pudimos calcular tus totales"
              : `${total} ${total === 1 ? "clienta" : "clientas"} | Total facturado: ${format(totalRevenue)}`}
          </p>
        </div>
        <Button onClick={handleNewClient} data-testid="button-add-client">
          <Plus className="h-4 w-4 mr-2" />
          Nueva Clienta
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, teléfono o email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-clients"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="relative w-full sm:w-auto"
          onClick={() => setFilterSheetOpen(true)}
          data-testid="button-open-filters"
        >
          <Filter className="h-4 w-4 mr-2" />
          Filtros
          {filter !== "todas" && (
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" data-testid="dot-filter-active" />
          )}
        </Button>
      </div>

      {filter !== "todas" && (
        <div>
          <button
            type="button"
            onClick={() => setFilter("todas")}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1.5 text-sm font-medium hover-elevate active-elevate-2"
            data-testid="chip-active-filter"
          >
            {CLIENT_LIST_FILTER_LABELS[filter]}
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando clientas...</div>
      ) : isError ? (
        <ErrorBlock message="No pudimos cargar tus clientas. Tus datos siguen intactos — probá recargar la página." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((client) => (
              <ClientCard key={client.id} client={client} onClick={handleClientClick} />
            ))}
          </div>

          {clients.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No se encontraron clientas
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2" data-testid="clients-pagination">
              <Button
                variant="outline"
                size="sm"
                className="h-10 px-3"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                data-testid="button-clients-prev-page"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground" data-testid="text-clients-page-indicator">
                Página {page} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-10 px-3"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                data-testid="button-clients-next-page"
              >
                Siguiente
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}

      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={editingClient}
        onSave={handleSave}
        existingClients={clients}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />

      <ClientDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        client={selectedClient}
        onEdit={handleEdit}
        onNewSale={handleNewSale}
      />

      <NewSaleDialog
        open={saleDialogOpen}
        onOpenChange={setSaleDialogOpen}
        products={products}
        preselectedClient={saleClient}
      />

      <Dialog open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <DialogContent className="max-w-sm" data-testid="dialog-filters">
          <DialogHeader>
            <DialogTitle>Filtros</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setFilter(option);
                  setFilterSheetOpen(false);
                }}
                className={cn(
                  "w-full rounded-xl border-2 p-4 text-left text-sm font-semibold hover-elevate active-elevate-2",
                  filter === option ? "border-primary bg-primary/10 text-primary" : "border-transparent bg-muted/50",
                )}
                data-testid={`option-filter-${option}`}
              >
                {CLIENT_LIST_FILTER_LABELS[option]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setFilter("todas");
                setFilterSheetOpen(false);
              }}
              className="w-full rounded-xl border-2 border-dashed border-border p-3 text-center text-sm font-medium text-muted-foreground hover-elevate active-elevate-2"
              data-testid="option-filter-ver-todas"
            >
              Ver todas
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
