import { forwardRef } from "react";
import type { LucideProps } from "lucide-react";

/**
 * lucide-react@0.453.0 no tiene un ícono de labial — este es un drop-in a mano, con el mismo
 * contrato de props que cualquier ícono de lucide (`LucideProps`, importado del paquete en vez
 * de reconstruido a mano, para que el tipo coincida exacto con `LucideIcon` donde se lo usa:
 * menú, barra inferior, hoja "Más").
 */
export const LipstickIcon = forwardRef<SVGSVGElement, LucideProps>(
  ({ size = 24, color = "currentColor", strokeWidth = 2, className, ...rest }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      <path d="M9 10c0-2.8 1.3-5 3-5s3 2.2 3 5" />
      <path d="M7 10h10l-1.2 9.6a1 1 0 0 1-1 .9H9.2a1 1 0 0 1-1-.9z" />
      <path d="M9.5 14h5" />
    </svg>
  ),
);
LipstickIcon.displayName = "LipstickIcon";
