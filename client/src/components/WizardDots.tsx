import { cn } from "@/lib/utils";

/** Indicador de progreso de N puntos — el paso actual y los ya completados quedan resaltados. */
export function WizardDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex gap-1.5 px-1" data-testid="wizard-progress">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={cn("h-1 flex-1 rounded-full", i <= current ? "bg-primary" : "bg-muted")} />
      ))}
    </div>
  );
}
