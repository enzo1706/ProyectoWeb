import { QueryClient, QueryFunction } from "@tanstack/react-query";

const GENERIC_ERROR_MESSAGE = "Ocurrió un problema. Intentá nuevamente en unos segundos.";

/** `message` siempre es texto listo para mostrar (español, sin JSON ni detalle técnico).
 * El detalle crudo del servidor queda solo en consola, para debugging. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Extrae un mensaje mostrable de un body de error. Los 4xx son validaciones/errores de
 * negocio que el propio backend redacta en español para mostrarse tal cual (ver
 * server/routes.ts) — se muestran directo. Los 5xx son fallas inesperadas: nunca confiamos
 * en su contenido (puede traer detalle técnico, incluso en inglés), siempre genérico.
 * Usado tanto por `apiRequest`/`getQueryFn` como por los uploads multipart que hacen su
 * propio `fetch` (no pueden pasar por `apiRequest`, que siempre manda JSON). */
export function extractFriendlyErrorMessage(status: number, rawText: string): string {
  if (status < 400 || status >= 500) return GENERIC_ERROR_MESSAGE;
  try {
    const body = JSON.parse(rawText);
    const extracted = body?.error ?? body?.message;
    if (typeof extracted === "string" && extracted.trim().length > 0) {
      return extracted;
    }
  } catch {
    // Cuerpo no era JSON (ej. proxy/HTML) — se queda con el mensaje genérico.
  }
  return GENERIC_ERROR_MESSAGE;
}

async function throwIfResNotOk(res: Response) {
  if (res.ok) return;

  const rawText = await res.text().catch(() => "");
  const friendlyMessage = extractFriendlyErrorMessage(res.status, rawText);
  console.error(`API error ${res.status} on ${res.url}:`, rawText);
  throw new ApiError(res.status, friendlyMessage);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
