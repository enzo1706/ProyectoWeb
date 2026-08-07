import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Shield, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Guarda sincrónico: `disabled={isSubmitting}` no alcanza para bloquear un
  // doble-submit real (ver client/src/hooks/use-guarded-mutation.ts).
  const isSubmittingRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const loggedIn = await login(username, password);
      setLocation(loggedIn.role === "admin" ? "/admin" : "/");
    } catch (error) {
      toast({
        title: "Error de acceso",
        description: error instanceof Error ? error.message : "Credenciales inválidas",
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
      data-testid="page-login"
    >
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary flex items-center justify-center shadow-md">
            <span className="text-primary-foreground font-bold text-xl">MK</span>
          </div>
          <h1 className="text-2xl font-bold text-[hsl(220,55%,22%)]">Mary Kay Manager</h1>
          <p className="text-sm text-muted-foreground">Inicia sesión para continuar</p>
        </div>

        <Card className="border-[hsl(330,15%,90%)] shadow-lg bg-white/90 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg text-[hsl(220,55%,22%)] flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Iniciar Sesión
            </CardTitle>
            <CardDescription>
              Ingresa tus credenciales de consultora o administrador
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Usuario</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="tu.usuario"
                  required
                  autoComplete="username"
                  data-testid="input-login-username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  data-testid="input-login-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
                data-testid="button-login-submit"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Ingresando...
                  </>
                ) : (
                  "Ingresar"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          ¿Problemas para acceder? Contacta a tu administradora.
        </p>
      </div>
    </div>
  );
}
