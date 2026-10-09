/**
 * Prompt 13 — para poder avisar "cerramos tu sesión por inactividad" sin guardar nada
 * sensible en el navegador: solo la FECHA del último uso con sesión iniciada, nunca un
 * usuario, token ni nada que identifique a nadie. Mismo criterio que use-hide-money/
 * ThemeToggle (localStorage para un dato chico de UI, no para algo que haga falta confiar).
 */

const LAST_ACTIVE_KEY = "mkm_last_active_at";
export const INACTIVITY_LIMIT_DAYS = 10;

export function markSessionActive(): void {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, new Date().toISOString());
  } catch {
    // Privado/bloqueado: el aviso de inactividad simplemente no se muestra, nunca rompe nada.
  }
}

export function clearSessionActivity(): void {
  try {
    localStorage.removeItem(LAST_ACTIVE_KEY);
  } catch {
    // Nada que limpiar si ni siquiera se puede leer/escribir.
  }
}

/** true solo si HABÍA una fecha registrada Y pasaron más de 10 días — nunca se inventa un
 * motivo para una sesión perdida por otra causa (cookies borradas, problema del servidor). */
export function wasClosedByInactivity(): boolean {
  try {
    const stored = localStorage.getItem(LAST_ACTIVE_KEY);
    if (!stored) return false;
    const lastActive = new Date(stored).getTime();
    if (Number.isNaN(lastActive)) return false;
    const elapsedDays = (Date.now() - lastActive) / (24 * 60 * 60 * 1000);
    return elapsedDays > INACTIVITY_LIMIT_DAYS;
  } catch {
    return false;
  }
}
