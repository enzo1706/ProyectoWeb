import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ChevronsUpDown, Plus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ClientDialog } from "./ClientDialog";
import type { Client } from "./ClientCard";

interface ClientComboboxProps {
  value: Client | null;
  onSelect: (client: Client) => void;
  id?: string;
}

export function ClientCombobox({ value, onSelect, id }: ClientComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const { data: clients = [], isFetching } = useQuery<Client[]>({
    queryKey: ["/api/clients", debouncedSearch, "combobox"],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "8" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await apiRequest("GET", `/api/clients?${params.toString()}`);
      return res.json();
    },
    enabled: open,
  });

  const createMutation = useGuardedMutation({
    mutationFn: async (data: Omit<Client, "id" | "totalPurchases" | "lastPurchase" | "consultantId">) => {
      const res = await apiRequest("POST", "/api/clients", data);
      return res.json() as Promise<Client>;
    },
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      onSelect(client);
      setCreateOpen(false);
    },
  });

  const displayLabel = value ? value.name?.trim() || value.phone : "Buscar clienta...";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            className="w-full justify-between font-normal"
            data-testid="button-client-combobox"
          >
            {displayLabel}
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Nombre, teléfono o email..."
              value={search}
              onValueChange={setSearch}
              data-testid="input-client-search"
            />
            <CommandList>
              {isFetching ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Buscando...</div>
              ) : clients.length === 0 ? (
                <CommandEmpty>
                  <div className="py-2 text-center space-y-2">
                    <p className="text-sm text-muted-foreground">No se encontraron clientas</p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setCreateOpen(true);
                        setOpen(false);
                      }}
                      data-testid="button-create-client-inline"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Crear clienta
                    </Button>
                  </div>
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {clients.map((client) => (
                    <CommandItem
                      key={client.id}
                      value={String(client.id)}
                      onSelect={() => {
                        onSelect(client);
                        setOpen(false);
                      }}
                      data-testid={`client-option-${client.id}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate">{client.name?.trim() || client.phone}</p>
                        <p className="text-xs text-muted-foreground">{client.phone}</p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <ClientDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        client={null}
        onSave={(data) => createMutation.mutate(data)}
      />
    </>
  );
}
