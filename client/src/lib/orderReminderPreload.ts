/** Prompt 8, Parte 3 — "Armar pedido con estos productos" (Inicio) abre Stock y precarga el
 * pedido ahí: no hay un store global compartido entre páginas, así que se usa sessionStorage
 * como mensajero de una sola lectura (Stock lo consume y lo borra apenas lo usa). */
const KEY = "impulsa:order-reminder-preload";

export function setOrderReminderPreload(qtyByProduct: Record<number, number>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(qtyByProduct));
  } catch {
    // Almacenamiento no disponible (privado/bloqueado): sin precarga, Stock abre vacío.
  }
}

export function consumeOrderReminderPreload(): Record<number, number> | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
