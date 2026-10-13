import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CompleteProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Prompt 14 — "Completá tu perfil" (ciudad, edad, cargo). El bloque "Para mejorar tu negocio"
 * de Inicio (Prompt 10) todavía no existe, así que este aviso vive provisoriamente en Inicio
 * como su propia tarjeta chica — cuando se implemente el Prompt 10, se muda a ese bloque (ver
 * la nota dejada en docs/prompts-mejoras.md bajo ese prompt).
 */
export function CompleteProfileDialog({ open, onOpenChange }: CompleteProfileDialogProps) {
  const { toast } = useToast();
  const [city, setCity] = useState("");
  const [age, setAge] = useState("");
  const [jobTitle, setJobTitle] = useState("");

  const mutation = useGuardedMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/consultant/profile", {
        city: city.trim() || null,
        age: age.trim() ? Number(age) : null,
        jobTitle: jobTitle.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-settings"] });
      toast({ title: "¡Gracias por completar tu perfil!" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo guardar", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-complete-profile">
        <DialogHeader>
          <DialogTitle>Completá tu perfil</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="profile-city">Ciudad</Label>
            <Input id="profile-city" value={city} onChange={(e) => setCity(e.target.value)} data-testid="input-profile-city" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-age">Edad</Label>
            <Input
              id="profile-age"
              type="number"
              min={14}
              max={100}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              data-testid="input-profile-age"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-job-title">Tu cargo</Label>
            <Input
              id="profile-job-title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Consultora, Directora..."
              data-testid="input-profile-job-title"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-complete-profile-later">
            Ahora no
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-save-profile">
            {mutation.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
