/** Prompt 15 — contador reutilizable: "1 clienta" / "2 clientas", nunca un plural fijo que
 * rompa en 1 ("1 ventas"). `singular`/`plural` se pasan explícitos porque el plural en
 * castellano no siempre es "agregar una s" (mes/meses, vez/veces). */
export function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
