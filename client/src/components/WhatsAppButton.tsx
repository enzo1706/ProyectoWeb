import { FaWhatsapp } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { buildWhatsAppLink } from "@shared/phone";
import { cn } from "@/lib/utils";

interface WhatsAppButtonProps {
  phone: string | null | undefined;
  /** "icon": botón redondo compacto (listas/tarjetas). "full": botón con label (detalle). */
  variant?: "icon" | "full";
  className?: string;
}

/**
 * Etapa 4 — único componente que arma un link de WhatsApp, reutilizado en ClientCard y
 * ClientDetailSheet (no se duplica esta lógica en cada lugar). No renderiza nada si el
 * teléfono no se puede normalizar de forma segura — nunca abre un WhatsApp equivocado ni deja
 * un botón que lleva a ningún lado. No manda ningún mensaje automáticamente: solo abre la
 * conversación (`window.open`, pestaña nueva) — el mecanismo estándar `wa.me`, sin API de
 * WhatsApp ni WhatsApp Business.
 */
export function WhatsAppButton({ phone, variant = "icon", className }: WhatsAppButtonProps) {
  const link = buildWhatsAppLink(phone);
  if (!link) return null;

  const handleClick = (e: React.MouseEvent) => {
    // Evita disparar el onClick de la card/fila que lo contiene (ej. abrir el detalle).
    e.stopPropagation();
    window.open(link, "_blank", "noopener,noreferrer");
  };

  if (variant === "full") {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        className={cn("border-emerald-600/30 text-emerald-700 dark:text-emerald-400", className)}
        data-testid="button-whatsapp"
      >
        <FaWhatsapp className="h-4 w-4 mr-2" />
        WhatsApp
      </Button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-emerald-600 hover-elevate active-elevate-2 dark:text-emerald-400",
        className,
      )}
      aria-label="Contactar por WhatsApp"
      title="Contactar por WhatsApp"
      data-testid="button-whatsapp"
    >
      <FaWhatsapp className="h-5 w-5" />
    </button>
  );
}
