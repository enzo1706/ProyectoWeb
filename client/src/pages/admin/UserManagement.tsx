import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Consultant {
  id: number;
  username: string;
  role: string;
  status: boolean;
}

export default function UserManagement() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const { data: consultants = [], isLoading } = useQuery<Consultant[]>({
    queryKey: ["/api/admin/users"],
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}/toggle-status`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/admin/users", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setDialogOpen(false);
      setUsername("");
      setPassword("");
      toast({ title: "Consultora creada", description: "La cuenta fue registrada correctamente." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ username, password });
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-user-management">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-7 w-7 text-primary" />
            Gestión de Consultoras
          </h1>
          <p className="text-muted-foreground mt-1">
            Administra el acceso y registro de consultoras Mary Kay
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Crear Nueva Consultora
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded-lg border bg-card shadow-sm p-8 text-center text-muted-foreground">
          Cargando consultoras...
        </div>
      ) : consultants.length === 0 ? (
        <div className="rounded-lg border bg-card shadow-sm p-8 text-center text-muted-foreground">
          No hay consultoras registradas. Crea la primera con el botón superior.
        </div>
      ) : (
        <>
          {/* Desktop/tablet: real table */}
          <div className="hidden sm:block rounded-lg border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted">
                  <TableHead className="text-foreground font-semibold">Usuario</TableHead>
                  <TableHead className="text-foreground font-semibold">Rol</TableHead>
                  <TableHead className="text-foreground font-semibold">Estado</TableHead>
                  <TableHead className="text-foreground font-semibold text-right">
                    Acceso
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consultants.map((consultant) => (
                  <TableRow key={consultant.id} data-testid={`row-consultant-${consultant.id}`}>
                    <TableCell className="font-medium">{consultant.username}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {consultant.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={consultant.status ? "default" : "destructive"}
                        className={consultant.status ? "bg-primary/90" : ""}
                      >
                        {consultant.status ? "Activa" : "Inactiva"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        <span className="text-xs text-muted-foreground">
                          {consultant.status ? "Acceso habilitado" : "Acceso desactivado"}
                        </span>
                        <Switch
                          checked={consultant.status}
                          onCheckedChange={() => toggleMutation.mutate(consultant.id)}
                          disabled={toggleMutation.isPending}
                          data-testid={`switch-status-${consultant.id}`}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards */}
          <div className="sm:hidden space-y-3">
            {consultants.map((consultant) => (
              <div
                key={consultant.id}
                className="rounded-lg border bg-card shadow-sm p-4 space-y-3"
                data-testid={`row-consultant-mobile-${consultant.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">{consultant.username}</p>
                  <Badge variant="secondary" className="capitalize shrink-0">
                    {consultant.role}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant={consultant.status ? "default" : "destructive"}
                    className={consultant.status ? "bg-primary/90" : ""}
                  >
                    {consultant.status ? "Activa" : "Inactiva"}
                  </Badge>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {consultant.status ? "Acceso habilitado" : "Acceso desactivado"}
                    </span>
                    <Switch
                      checked={consultant.status}
                      onCheckedChange={() => toggleMutation.mutate(consultant.id)}
                      disabled={toggleMutation.isPending}
                      data-testid={`switch-status-mobile-${consultant.id}`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Crear Nueva Consultora
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Nombre de usuario</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ej. maria.garcia"
                required
                minLength={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                minLength={6}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creando..." : "Registrar Consultora"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
