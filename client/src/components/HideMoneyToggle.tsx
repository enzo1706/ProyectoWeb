import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHideMoney } from "@/hooks/use-hide-money";

export function HideMoneyToggle() {
  const { hidden, toggle } = useHideMoney();

  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={toggle}
      title={hidden ? "Mostrar montos" : "Ocultar montos"}
      aria-label={hidden ? "Mostrar montos" : "Ocultar montos"}
      data-testid="button-hide-money-toggle"
    >
      {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  );
}
