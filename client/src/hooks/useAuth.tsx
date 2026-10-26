import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { markSessionActive, clearSessionActivity } from "@/lib/sessionActivity";
import { unsubscribeCurrentDevice } from "@/lib/pushNotifications";

export interface AuthUser {
  id: number;
  username: string;
  role: string;
  status: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  /** Prompt 14 — `identifier` acepta email, WhatsApp o un usuario viejo (el backend decide con
   * cuál buscar). Ya no es necesariamente un "username". */
  login: (identifier: string, password: string) => Promise<AuthUser>;
  /** Etapa 3: registro público — igual que login, deja la sesión iniciada.
   * Prompt 14: ya no pide "usuario" — nombre, email, WhatsApp y contraseña. */
  register: (input: { contactName: string; email: string; whatsapp: string; password: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Error al obtener sesión");
  return res.json();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const current = await fetchCurrentUser();
      setUser(current);
      // Prompt 13: "entrar a la app" con sesión iniciada — cada confirmación exitosa corre
      // la fecha, para que la pantalla de ingreso pueda distinguir "se cerró por inactividad"
      // de "nunca entró"/"se cerró por otro motivo".
      if (current) markSessionActive();
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (identifier: string, password: string): Promise<AuthUser> => {
    const res = await apiRequest("POST", "/api/auth/login", { identifier, password });
    const data = await res.json();
    setUser(data);
    markSessionActive();
    return data;
  };

  const register = async (input: { contactName: string; email: string; whatsapp: string; password: string }): Promise<AuthUser> => {
    const res = await apiRequest("POST", "/api/auth/register", input);
    const data = await res.json();
    setUser(data);
    markSessionActive();
    return data;
  };

  const logout = async () => {
    // Prompt 8, Parte 4 — ANTES de cerrar sesión: todavía autenticada, puede borrar su propia
    // suscripción push. Después del logout ya no podría (la ruta exige sesión).
    await unsubscribeCurrentDevice();
    await apiRequest("POST", "/api/auth/logout");
    setUser(null);
    // Cierre A PROPÓSITO — nunca tiene que mostrarse como "se cerró por inactividad".
    clearSessionActivity();
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe usarse dentro de AuthProvider");
  }
  return context;
}
