import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { KeyRound, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Step = "email" | "code" | "password" | "done";

/**
 * Etapa 3 — flujo de 3 pasos en una sola página (mismo criterio que otros flujos de varios
 * pasos ya existentes en la app, ej. NewSaleDialog): email -> código -> nueva contraseña.
 * El código se re-envía junto con la nueva contraseña en el paso final (el backend vuelve a
 * validarlo ahí — verify-reset-code es solo feedback de UX, la validación real y el contador
 * de intentos son compartidos entre los dos pasos, ver server/auth-reset.ts).
 */
export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/auth/forgot-password", { email });
      const data = await res.json();
      toast({ title: data.message });
      setStep("code");
    } catch (error) {
      toast({
        title: "No se pudo procesar la solicitud",
        description: error instanceof Error ? error.message : "Intentá nuevamente.",
        variant: "destructive",
      });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/auth/verify-reset-code", { email, code });
      setStep("password");
    } catch (error) {
      toast({
        title: "Código inválido",
        description: error instanceof Error ? error.message : "Revisá el código e intentá de nuevo.",
        variant: "destructive",
      });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    if (newPassword !== confirmPassword) {
      toast({ title: "Las contraseñas no coinciden", variant: "destructive" });
      return;
    }
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", { email, code, newPassword });
      setStep("done");
    } catch (error) {
      toast({
        title: "No se pudo restablecer la contraseña",
        description: error instanceof Error ? error.message : "Intentá nuevamente desde el principio.",
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
      data-testid="page-forgot-password"
    >
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary flex items-center justify-center shadow-md">
            <span className="text-primary-foreground font-bold text-xl">MK</span>
          </div>
          <h1 className="text-2xl font-bold text-[hsl(220,55%,22%)]">Mary Kay Manager</h1>
        </div>

        <Card className="border-[hsl(330,15%,90%)] shadow-lg bg-white/90 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg text-[hsl(220,55%,22%)] flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Recuperar contraseña
            </CardTitle>
            {step === "email" && <CardDescription>Ingresá el email de tu cuenta</CardDescription>}
            {step === "code" && <CardDescription>Ingresá el código que recibiste en tu email</CardDescription>}
            {step === "password" && <CardDescription>Elegí tu nueva contraseña</CardDescription>}
            {step === "done" && <CardDescription>Listo</CardDescription>}
          </CardHeader>
          <CardContent>
            {step === "email" && (
              <form onSubmit={handleRequestCode} className="space-y-4" data-testid="form-forgot-email">
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">Email</Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    required
                    autoComplete="email"
                    data-testid="input-forgot-email"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-send-code">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    "Enviar código"
                  )}
                </Button>
              </form>
            )}

            {step === "code" && (
              <form onSubmit={handleVerifyCode} className="space-y-4" data-testid="form-forgot-code">
                <div className="space-y-2">
                  <Label htmlFor="forgot-code">Código de 6 dígitos</Label>
                  <Input
                    id="forgot-code"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    required
                    className="text-center text-2xl tracking-[0.5em] font-mono"
                    data-testid="input-reset-code"
                  />
                  <p className="text-xs text-muted-foreground">El código vence a los 10 minutos.</p>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting || code.length !== 6}
                  data-testid="button-verify-code"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Verificando...
                    </>
                  ) : (
                    "Verificar código"
                  )}
                </Button>
              </form>
            )}

            {step === "password" && (
              <form onSubmit={handleResetPassword} className="space-y-4" data-testid="form-forgot-new-password">
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nueva contraseña</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    required
                    autoComplete="new-password"
                    data-testid="input-new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirmar contraseña</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    required
                    autoComplete="new-password"
                    data-testid="input-confirm-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-reset-password">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Restableciendo...
                    </>
                  ) : (
                    "Restablecer contraseña"
                  )}
                </Button>
              </form>
            )}

            {step === "done" && (
              <div className="flex flex-col items-center gap-4 py-4 text-center" data-testid="text-reset-done">
                <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                <p className="text-sm text-foreground">
                  Tu contraseña se actualizó correctamente. Ya podés iniciar sesión con ella.
                </p>
                <Button className="w-full" onClick={() => setLocation("/login")} data-testid="button-go-login-after-reset">
                  Ir a iniciar sesión
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {step !== "done" && (
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="font-medium text-primary hover:underline" data-testid="link-back-to-login">
              Volver a iniciar sesión
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
