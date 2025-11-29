import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClientCard, type Client } from "@/components/ClientCard";
import { ClientDialog } from "@/components/ClientDialog";
import { ClientDetailSheet } from "@/components/ClientDetailSheet";
import { Plus, Search, Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// todo: remove mock functionality
const initialClients: Client[] = [
  { id: "1", name: "María García López", phone: "+52 555 123 4567", email: "maria.garcia@email.com", category: "vip", totalPurchases: 2450.00, lastPurchase: "15 Nov 2025", birthday: "1990-03-15", address: "Col. Roma Norte, CDMX" },
  { id: "2", name: "Ana Martínez Ruiz", phone: "+52 555 234 5678", email: "ana.martinez@email.com", category: "frecuente", totalPurchases: 1280.00, lastPurchase: "22 Nov 2025", birthday: "1985-07-22" },
  { id: "3", name: "Laura Hernández", phone: "+52 555 345 6789", email: "laura.h@email.com", category: "frecuente", totalPurchases: 890.00, lastPurchase: "10 Nov 2025", birthday: "1992-11-08" },
  { id: "4", name: "Patricia Ruiz Sánchez", phone: "+52 555 456 7890", email: "patricia.ruiz@email.com", category: "nueva", totalPurchases: 165.00, lastPurchase: "28 Nov 2025" },
  { id: "5", name: "Carmen Flores", phone: "+52 555 567 8901", email: "carmen.f@email.com", category: "frecuente", totalPurchases: 720.00, lastPurchase: "25 Nov 2025", birthday: "1988-05-30" },
  { id: "6", name: "Rosa Elena Mendoza", phone: "+52 555 678 9012", email: "rosa.mendoza@email.com", category: "inactiva", totalPurchases: 350.00, lastPurchase: "15 Ago 2025" },
  { id: "7", name: "Guadalupe Torres", phone: "+52 555 789 0123", email: "lupe.torres@email.com", category: "vip", totalPurchases: 3200.00, lastPurchase: "27 Nov 2025", birthday: "1983-12-12", address: "Col. Condesa, CDMX" },
  { id: "8", name: "Sofía Ramírez", phone: "+52 555 890 1234", email: "sofia.r@email.com", category: "nueva", totalPurchases: 85.00, lastPurchase: "26 Nov 2025" },
];

const categoryFilters = [
  { value: "todas", label: "Todas" },
  { value: "vip", label: "VIP" },
  { value: "frecuente", label: "Frecuentes" },
  { value: "nueva", label: "Nuevas" },
  { value: "inactiva", label: "Inactivas" },
];

export default function Clientas() {
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("todas");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const filteredClients = clients.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      c.email.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "todas" || c.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const handleSave = (client: Omit<Client, "id" | "totalPurchases" | "lastPurchase">) => {
    if (editingClient) {
      setClients(clients.map(c => 
        c.id === editingClient.id 
          ? { ...c, ...client } 
          : c
      ));
    } else {
      const newClient: Client = {
        ...client,
        id: `c${Date.now()}`,
        totalPurchases: 0,
      };
      setClients([...clients, newClient]);
    }
    setDialogOpen(false);
    setEditingClient(null);
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

  const vipCount = clients.filter(c => c.category === "vip").length;
  const totalRevenue = clients.reduce((sum, c) => sum + c.totalPurchases, 0);

  return (
    <div className="p-6 space-y-6" data-testid="page-clientas">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Clientas</h1>
          <p className="text-muted-foreground">
            {clients.length} clientas | {vipCount} VIP | Total facturado: ${totalRevenue.toFixed(2)}
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
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-client-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            {categoryFilters.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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

      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={editingClient}
        onSave={handleSave}
      />

      <ClientDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        client={selectedClient}
        onEdit={handleEdit}
      />
    </div>
  );
}
