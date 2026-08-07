import { useRef } from "react";
import { useMutation, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";

/**
 * Envoltorio de `useMutation` que bloquea llamadas repetidas a `mutate()` mientras una
 * ya está en curso. `disabled={mutation.isPending}` en el botón no alcanza: hay una
 * ventana real entre el click y el re-render de React donde un doble click dispara dos
 * requests. Este guard usa un ref (sincrónico, fuera del ciclo de render) para cerrar esa
 * ventana. Interfaz idéntica a `useMutation` — reemplazo directo.
 */
export function useGuardedMutation<TData = unknown, TError = Error, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const isRunningRef = useRef(false);

  const mutation = useMutation({
    ...options,
    onSettled: (data, error, variables, context) => {
      isRunningRef.current = false;
      options.onSettled?.(data, error, variables, context);
    },
  });

  const guardedMutate: UseMutationResult<TData, TError, TVariables, TContext>["mutate"] = (variables, mutateOptions) => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    mutation.mutate(variables, mutateOptions);
  };

  return { ...mutation, mutate: guardedMutate };
}
