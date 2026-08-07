/** Estilo de tooltip compartido por todos los gráficos recharts de la app (Dashboard, Reportes). */
export const chartTooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
};

/** Paleta compartida para series categóricas dinámicas (categorías de producto, etc.). */
export const chartPalette = [
  "hsl(330, 81%, 45%)",
  "hsl(280, 65%, 40%)",
  "hsl(200, 70%, 35%)",
  "hsl(25, 75%, 40%)",
  "hsl(140, 60%, 40%)",
  "hsl(45, 90%, 45%)",
];

export function colorForIndex(index: number): string {
  return chartPalette[index % chartPalette.length];
}
