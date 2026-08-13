/** Corre `worker` sobre `items` con a lo sumo `limit` ejecuciones simultáneas. Un error en
 * un `worker` individual no debe frenar a los demás — por eso `worker` nunca debe rechazar
 * la promesa hacia afuera; el llamador es responsable de capturar sus propios errores. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;

  async function runNext(): Promise<void> {
    const current = cursor++;
    if (current >= items.length) return;
    await worker(items[current], current);
    return runNext();
  }

  const runnerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: runnerCount }, () => runNext()));
}
