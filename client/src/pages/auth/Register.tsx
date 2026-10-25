import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { UserPlus, Loader2, TrendingUp, Clock, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BrandLogo } from "@/components/BrandLogo";
import { WHATSAPP_FORMAT_HINT } from "@/lib/phoneHint";
import { normalizeArgentinaPhoneDigits } from "@shared/phone";

const BENEFITS = [
  { icon: TrendingUp, text: "Sabé cuánto ganás en cada venta" },
  { icon: Clock, text: "Controlá quién te debe y cobrá a tiempo" },
  { icon: Package, text: "Tu stock al día, con avisos de qué pedir" },
];

export default function Register() {
  const { register } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Mismo guard sincrónico que Login.tsx — disabled={isSubmitting} solo no alcanza para
  // bloquear un doble-submit real (ver client/src/hooks/use-guarded-mutation.ts).
  const isSubmittingRef = useRef(false);

  const invalidWhatsapp = whatsapp.trim() !== "" && !normalizeArgentinaPhoneDigits(whatsapp).valid;
  // "Las contraseñas no coinciden" solo se muestra una vez que la segunda ya tiene algo
  // escrito — mostrarlo mientras todavía está vacía solo asusta sin avisar nada real.
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || invalidWhatsapp || passwordsMismatch) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      await register({ contactName, email, whatsapp, password });
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
          <BrandLogo size={56} className="mx-auto shadow-md" />
          <h1 className="text-2xl font-bold text-[hsl(220,55%,22%)]">Mary Kay Manager</h1>
          <p className="text-sm text-muted-foreground">Creá tu cuenta de consultora</p>
        </div>

        <ul className="space-y-2" data-testid="list-register-benefits">
          {BENEFITS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-[hsl(220,55%,22%)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              {text}
            </li>
          ))}
        </ul>

        <Card className="border-[hsl(330,15%,90%)] shadow-lg bg-white/90 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg text-[hsl(220,55%,22%)] flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Crear cuenta
            </CardTitle>
            <CardDescription>Probala gratis con hasta 10 productos. Sin tarjeta.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="register-contact-name">Nombre y apellido</Label>
                <Input
                  id="register-contact-name"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Tu nombre y apellido"
                  required
                  autoComplete="name"
                  data-testid="input-register-contact-name"
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
                <Label htmlFor="register-whatsapp">WhatsApp</Label>
                <Input
                  id="register-whatsapp"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="261 555 1234"
                  required
                  autoComplete="tel"
                  data-testid="input-register-whatsapp"
                />
                {invalidWhatsapp && (
                  <p className="text-sm text-destructive" data-testid="text-register-whatsapp-hint">
                    {WHATSAPP_FORMAT_HINT}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-password">Contraseña</Label>
                <PasswordInput
                  id="register-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  required
                  autoComplete="new-password"
                  data-testid="input-register-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-confirm-password">Repetí la contraseña</Label>
                <PasswordInput
                  id="register-confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  required
                  autoComplete="new-password"
                  data-testid="input-register-confirm-password"
                />
                {passwordsMismatch && (
                  <p className="text-sm text-destructive" data-testid="text-register-password-mismatch">
                    Las contraseñas no coinciden
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting || invalidWhatsapp || passwordsMismatch}
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
