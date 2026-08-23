import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClientCard, type Client } from "@/components/ClientCard";
import { ClientDialog } from "@/components/ClientDialog";
import { ClientDetailSheet } from "@/components/ClientDetailSheet";
import { NewSaleDialog } from "@/components/NewSaleDialog";
import { Plus, Search } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";
import { toDateStr, daysBetween } from "@/lib/date";
import type { InsertClient, Product } from "@shared/schema";

type BalanceFilter = "todas" | "con_saldo" | "sin_saldo";
type StaleFilter = "todas" | "mas_2_meses" | "mas_3_meses";

const STALE_THRESHOLDS: Record<Exclude<StaleFilter, "todas">, number> = {
  mas_2_meses: 60,
  mas_3_meses: 90,
};

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
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("todas");
  const [staleFilter, setStaleFilter] = useState<StaleFilter>("todas");
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

  // Combina ambos filtros con AND. "Nunca compró" (lastPurchase null) nunca matchea un filtro
  // de antigüedad — solo se distingue de "compró hace tiempo" cuando el filtro está en "Todas".
  const filteredClients = useMemo(() => {
    const today = toDateStr(new Date());
    return clients.filter((client) => {
      const pendingBalance = client.pendingBalance ?? 0;
      if (balanceFilter === "con_saldo" && pendingBalance <= 0) return false;
      if (balanceFilter === "sin_saldo" && pendingBalance > 0) return false;

      if (staleFilter !== "todas") {
        if (!client.lastPurchase) return false;
        const daysSinceLastPurchase = daysBetween(client.lastPurchase, today);
        if (daysSinceLastPurchase <= STALE_THRESHOLDS[staleFilter]) return false;
      }

      return true;
    });
  }, [clients, balanceFilter, staleFilter]);

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

  const totalRevenue = filteredClients.reduce((sum, c) => sum + c.totalPurchases, 0);

  return (
    <div className="p-6 space-y-6" data-testid="page-clientas">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Clientas</h1>
          <p className="text-muted-foreground">
            {filteredClients.length} clientas | Total facturado: {format(totalRevenue)}
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
        <Select value={balanceFilter} onValueChange={(v) => setBalanceFilter(v as BalanceFilter)}>
          <SelectTrigger className="w-full sm:w-[190px]" data-testid="select-balance-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas" data-testid="option-balance-todas">Todas</SelectItem>
            <SelectItem value="con_saldo" data-testid="option-balance-con-saldo">Con saldo pendiente</SelectItem>
            <SelectItem value="sin_saldo" data-testid="option-balance-sin-saldo">Sin saldo pendiente</SelectItem>
          </SelectContent>
        </Select>
        <Select value={staleFilter} onValueChange={(v) => setStaleFilter(v as StaleFilter)}>
          <SelectTrigger className="w-full sm:w-[190px]" data-testid="select-stale-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas" data-testid="option-stale-todas">Todas</SelectItem>
            <SelectItem value="mas_2_meses" data-testid="option-stale-2-meses">Más de 2 meses</SelectItem>
            <SelectItem value="mas_3_meses" data-testid="option-stale-3-meses">Más de 3 meses</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando clientas...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredClients.map((client) => (
              <ClientCard key={client.id} client={client} onClick={handleClientClick} />
            ))}
          </div>

          {filteredClients.length === 0 && (
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
    </div>
  );
}
