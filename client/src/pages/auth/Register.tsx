import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { UserPlus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Register() {
  const { register } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Mismo guard sincrónico que Login.tsx — disabled={isSubmitting} solo no alcanza para
  // bloquear un doble-submit real (ver client/src/hooks/use-guarded-mutation.ts).
  const isSubmittingRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      await register({ username, email, password });
      setLocation("/");
    } catch (error) {
      toast({
        title: "No se pudo crear la cuenta",
        description: error instanceof Error ? error.message : "Intentá nuevamente.",
        variant: "destructive",
      });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[hsl(330,25%,97%)] via-white to-[hsl(220,30%,96%)]"
      data-testid="page-register"
    >
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary flex items-center justify-center shadow-md">
            <span className="text-primary-foreground font-bold text-xl">MK</span>
          </div>
          <h1 className="text-2xl font-bold text-[hsl(220,55%,22%)]">Mary Kay Manager</h1>
          <p className="text-sm text-muted-foreground">Creá tu cuenta de consultora</p>
        </div>

        <Card className="border-[hsl(330,15%,90%)] shadow-lg bg-white/90 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg text-[hsl(220,55%,22%)] flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Registrarse
            </CardTitle>
            <CardDescription>10 días de prueba gratis, sin tarjeta</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="register-username">Usuario</Label>
                <Input
                  id="register-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="tu.usuario"
                  minLength={3}
                  required
                  autoComplete="username"
                  data-testid="input-register-username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  required
                  autoComplete="email"
                  data-testid="input-register-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-password">Contraseña</Label>
                <Input
                  id="register-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  required
                  autoComplete="new-password"
                  data-testid="input-register-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
                data-testid="button-register-submit"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creando cuenta...
                  </>
                ) : (
                  "Crear cuenta"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          ¿Ya tenés una cuenta?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline" data-testid="link-go-login">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
