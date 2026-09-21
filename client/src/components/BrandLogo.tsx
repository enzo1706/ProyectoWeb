import { cn } from "@/lib/utils";

interface BrandLogoProps {
  /** Lado en px; también se usa como width/height del <img> para reservar el espacio (sin layout shift). */
  size: number;
  /** Vacío = decorativo (el nombre de la app ya está escrito al lado). Pasar texto solo si el logo va solo. */
  alt?: string;
  className?: string;
}

/** Único punto que referencia el isotipo oficial (public/logo-impulsa.svg). Es solo el ícono, el nombre va aparte en texto. */
export function BrandLogo({ size, alt = "", className }: BrandLogoProps) {
  return (
    <img
      src="/logo-impulsa.svg"
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      className={cn("block shrink-0 select-none rounded-[18%]", className)}
    />
  );
}
