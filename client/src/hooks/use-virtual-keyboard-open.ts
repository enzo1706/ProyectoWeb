import { useEffect, useState } from "react";

const TEXT_INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Prompt 13 — la barra de navegación inferior es `position: fixed`, así que en mobile el
 * teclado virtual no la empuja: queda flotando arriba del teclado, tapando lo que se está
 * escribiendo. Sin una API estándar para "el teclado está abierto", se infiere por foco:
 * un input/textarea/select enfocado implica teclado abierto en touch devices.
 */
export function useVirtualKeyboardOpen(): boolean {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const isTextInput = (el: Element | null) => !!el && TEXT_INPUT_TAGS.has(el.tagName);

    const handleFocusIn = (e: FocusEvent) => {
      if (isTextInput(e.target as Element)) setIsOpen(true);
    };
    const handleFocusOut = (e: FocusEvent) => {
      if (isTextInput(e.target as Element)) setIsOpen(false);
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  return isOpen;
}
