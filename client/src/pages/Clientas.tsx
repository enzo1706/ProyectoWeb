import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClientCard, type Client } from "@/components/ClientCard";
import { ClientDialog } from "@/components/ClientDialog";
import { ClientDetailSheet } from "@/components/ClientDetailSheet";
import { NewSaleDialog } from "@/components/NewSaleDialog";
import { Plus, Search } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatPrice } from "@/lib/currency";
import type { InsertClient, Product } from "@shared/schema";

export default function Clientas() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [saleDialogOpen, setSaleDialogOpen] = useState(false);
  const [saleClient, setSaleClient] = useState<Client | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients", debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await apiRequest("GET", `/api/clients?${params.toString()}`);
      return res.json();
    },
  });

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

  const totalRevenue = clients.reduce((sum, c) => sum + c.totalPurchases, 0);

  return (
    <div className="p-6 space-y-6" data-testid="page-clientas">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Clientas</h1>
          <p className="text-muted-foreground">
            {clients.length} clientas | Total facturado: {formatPrice(totalRevenue)}
          </p>
        </div>
        <Button onClick={handleNewClient} data-testid="button-add-client">
          <Plus className="h-4 w-4 mr-2" />
          Nueva Clienta
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
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
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando clientas...</div>
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
        </>
      )}

      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={editingClient}
        onSave={handleSave}
        existingClients={clients}
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
    </div>
  );
}
