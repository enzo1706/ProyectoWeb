import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface UnsavedDraftAlertProps {
  open: boolean;
  onKeepEditing: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
}

/** Prompt 7, punto 2 — al tocar la X (o volver atrás) con algo ya cargado. Tres botones, no el
 * par Cancelar/Aceptar de siempre, así que compone Button a mano dentro del footer en vez de
 * AlertDialogAction/AlertDialogCancel. */
export function UnsavedDraftAlert({ open, onKeepEditing, onSaveDraft, onDiscard }: UnsavedDraftAlertProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onKeepEditing()}>
      <AlertDialogContent data-testid="dialog-unsaved-draft">
        <AlertDialogHeader>
          <AlertDialogTitle>¿Querés guardar lo que cargaste?</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onKeepEditing} data-testid="button-unsaved-draft-keep-editing">
            Seguir cargando
          </Button>
          <Button type="button" variant="destructive" className="w-full sm:w-auto" onClick={onDiscard} data-testid="button-unsaved-draft-discard">
            Descartar
          </Button>
          <Button type="button" className="w-full sm:w-auto" onClick={onSaveDraft} data-testid="button-unsaved-draft-save">
            Guardar borrador
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
