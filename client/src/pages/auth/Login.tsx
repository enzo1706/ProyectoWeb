import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BrandLogo } from "@/components/BrandLogo";
import { wasClosedByInactivity, clearSessionActivity } from "@/lib/sessionActivity";
import { WHATSAPP_FORMAT_HINT, looksLikeInvalidPhone } from "@/lib/phoneHint";

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  // Prompt 14 — acepta email, WhatsApp o un usuario viejo; el backend decide con cuál buscar.
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const invalidPhoneHint = looksLikeInvalidPhone(identifier);
  // Prompt 13 — se evalúa una sola vez, al entrar a esta pantalla (no en cada render): si no
  // fue por inactividad, nunca se inventa un motivo. Se borra enseguida — es un aviso de una
  // sola vez, no algo que deba seguir apareciendo si se recarga esta misma pantalla después.
  const [showInactivityNotice] = useState(() => {
    const closedByInactivity = wasClosedByInactivity();
    if (closedByInactivity) clearSessionActivity();
    return closedByInactivity;
  });
  // Guarda sincrónico: `disabled={isSubmitting}` no alcanza para bloquear un
  // doble-submit real (ver client/src/hooks/use-guarded-mutation.ts).
  const isSubmittingRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || invalidPhoneHint) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const loggedIn = await login(identifier, password);
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
          <BrandLogo size={56} className="mx-auto shadow-md" />
          <h1 className="text-2xl font-bold text-[hsl(220,55%,22%)]">Mary Kay Manager</h1>
          <p className="text-sm text-muted-foreground">Entrá con tu email o tu WhatsApp</p>
        </div>

        {showInactivityNotice && (
          <p
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-center text-sm text-amber-700 dark:text-amber-400"
            data-testid="text-inactivity-notice"
          >
            Por seguridad cerramos tu sesión porque pasaron más de 10 días sin entrar.
          </p>
        )}

        <Card className="border-[hsl(330,15%,90%)] shadow-lg bg-white/90 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg text-[hsl(220,55%,22%)] flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Iniciar sesión
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identifier">Email o WhatsApp</Label>
                <Input
                  id="identifier"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="tu@email.com o 261 555 1234"
                  required
                  autoComplete="username"
                  data-testid="input-login-identifier"
                />
                {invalidPhoneHint && (
                  <p className="text-sm text-destructive" data-testid="text-login-phone-hint">
                    {WHATSAPP_FORMAT_HINT}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <PasswordInput
                  id="password"
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
                disabled={isSubmitting || invalidPhoneHint}
                data-testid="button-login-submit"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Ingresando...
                  </>
                ) : (
                  "Iniciar sesión"
                )}
              </Button>
              <p className="text-center">
                <Link
                  href="/recuperar-contrasena"
                  className="text-sm text-muted-foreground hover:text-primary hover:underline"
                  data-testid="link-forgot-password"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setLocation("/register")}
                data-testid="link-go-register"
              >
                Crear cuenta
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
