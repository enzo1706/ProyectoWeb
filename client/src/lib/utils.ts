import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { KeyboardEvent } from "react"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Activa `onActivate` con Enter/Espacio — para elementos no interactivos (Card, div) que
 * ya tienen role="button"+tabIndex y necesitan comportarse como un botón real por teclado. */
export function onActivationKeyDown(onActivate: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    }
  };
}
