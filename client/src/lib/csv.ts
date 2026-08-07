/** Arma y descarga un CSV a partir de encabezados y filas, sin depender de ninguna librería externa. */
export function exportToCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escapeCell = (value: string | number): string => {
    const str = String(value);
    return /[";\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(";"));
  // BOM (﻿) + ";" como separador: así Excel en configuración regional es-AR/es-MX lo abre
  // directo, con acentos correctos y sin columnas corridas (la coma es separador decimal ahí).
  const csvContent = "\uFEFF" + lines.join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
