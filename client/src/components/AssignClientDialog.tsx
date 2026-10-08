import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Plus, Search, User } from "lucide-react";
import { ClientDialog } from "./ClientDialog";
import type { Client } from "./ClientCard";
import type { Sale } from "./SaleCard";

interface AssignClientDialogProps {
  /** La venta "Sin clienta" a la que se le va a asignar una — `null` cierra el diálogo. */
  sale: Sale | null;
  onOpenChange: (open: boolean) => void;
}

/** Prompt 6, punto 1 — "Asignar clienta" a una venta que se creó con "Completar después".
 * Mismo buscador + "Nueva clienta" que el paso "Clienta" del wizard de Nueva venta, pero acá
 * la venta ya existe: solo cambia a quién está asignada. */
export function AssignClientDialog({ sale, onOpenChange }: AssignClientDialogProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [createClientOpen, setCreateClientOpen] = useState(false);

  useEffect(() => {
    if (!sale) setSearch("");
  }, [sale]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: clientResults = [], isFetching: isFetchingClients } = useQuery<Client[]>({
    queryKey: ["/api/clients", debouncedSearch, "assign-sale"],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "8" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await apiRequest("GET", `/api/clients?${params.toString()}`);
      return res.json();
    },
    enabled: sale !== null,
  });

  const invalidateAfterAssign = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sales"] });
    if (sale) queryClient.invalidateQueries({ queryKey: ["/api/sales", sale.id] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
  };

  const assignMutation = useGuardedMutation({
    mutationFn: async (clientId: number) => {
      const res = await apiRequest("PATCH", `/api/sales/${sale!.id}/client`, { clientId });
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterAssign();
      toast({ title: "Clienta asignada" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo asignar la clienta", description: err.message, variant: "destructive" });
    },
  });

  const createClientMutation = useGuardedMutation({
    mutationFn: async (data: Omit<Client, "id" | "totalPurchases" | "lastPurchase" | "consultantId">) => {
      const res = await apiRequest("POST", "/api/clients", data);
      return res.json() as Promise<Client>;
    },
    onSuccess: (created: Client) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setCreateClientOpen(false);
      assignMutation.mutate(created.id);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo crear la clienta", description: err.message, variant: "destructive" });
    },
  });

  return (
    <>
      <Dialog open={sale !== null} onOpenChange={(next) => !next && onOpenChange(false)}>
        <DialogContent className="max-w-md" data-testid="dialog-assign-client">
          <DialogHeader>
            <DialogTitle>Asignar clienta</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar por nombre, teléfono o email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-assign-client-search"
              />
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {isFetchingClients ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Buscando...</p>
              ) : clientResults.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground" data-testid="text-no-clients-found-assign">
                  No se encontraron clientas
                </p>
              ) : (
                clientResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={assignMutation.isPending}
                    onClick={() => assignMutation.mutate(c.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border bg-muted/40 p-3 text-left hover-elevate active-elevate-2",
                      assignMutation.isPending && "opacity-60",
                    )}
                    data-testid={`assign-client-option-${c.id}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <User className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name?.trim() || c.phone}</p>
                      <p className="text-xs text-muted-foreground">{c.phone}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full border-dashed"
              onClick={() => setCreateClientOpen(true)}
              data-testid="button-new-client-assign"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nueva clienta
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ClientDialog
        open={createClientOpen}
        onOpenChange={setCreateClientOpen}
        client={null}
        onSave={(data) => createClientMutation.mutate(data)}
        isSaving={createClientMutation.isPending}
      />
    </>
  );
}
