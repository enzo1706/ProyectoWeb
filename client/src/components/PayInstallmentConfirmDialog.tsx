import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useGuardedMutation } from "@/hooks/use-guarded-mutation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useHideMoney } from "@/hooks/use-hide-money";

export interface PayableInstallment {
  saleId: number;
  installmentId: number;
  clientName: string;
  amount: number;
}

/**
 * Prompt 10 (Inicio) + Prompt 12 (Agenda) — "Cobrada" sobre una cuota pendiente: componente
 * compartido para que los dos lugares pegen al MISMO camino, nunca uno cada uno. Cobra el
 * SALDO real (`amount` ya viene como `amount - amountPaid`, la misma cuenta que usa Clientas) vía
 * el PATCH que ya existe desde el Prompt 9 (`registerInstallmentPayment`/
 * `applyPaymentToInstallments` — crea `client_payments` + `payment_allocations` en la misma
 * transacción), nunca cambiando el estado de la cuota a mano.
 */
export function PayInstallmentConfirmDialog({
  installment,
  onOpenChange,
}: {
  installment: PayableInstallment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { format } = useHideMoney();
  const { toast } = useToast();

  const payInstallmentMutation = useGuardedMutation({
    mutationFn: async (inst: PayableInstallment) => {
      const res = await apiRequest("PATCH", `/api/sales/${inst.saleId}/installments/${inst.installmentId}`, { status: "pagado" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agenda/month"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({
        predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/reports"),
      });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "No se pudo registrar el cobro", description: err.message, variant: "destructive" });
      onOpenChange(false);
    },
  });

  return (
    <AlertDialog open={installment !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dialog-confirm-pay-installment">
        <AlertDialogHeader>
          <AlertDialogTitle>
            ¿{installment?.clientName} te pagó los {installment ? format(installment.amount) : ""}?
          </AlertDialogTitle>
          <AlertDialogDescription>Se va a registrar como un pago, igual que "Registrar pago" en la ficha de la clienta.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-pay-installment">Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={payInstallmentMutation.isPending}
            onClick={() => installment && payInstallmentMutation.mutate(installment)}
            data-testid="button-confirm-pay-installment"
          >
            Sí, me pagó
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
