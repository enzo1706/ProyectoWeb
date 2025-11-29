import { useState } from "react";
import { ClientDialog } from "../ClientDialog";
import { Button } from "@/components/ui/button";

export default function ClientDialogExample() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Abrir Dialog</Button>
      <ClientDialog
        open={open}
        onOpenChange={setOpen}
        client={null}
        onSave={(client) => console.log("Clienta guardada:", client)}
      />
    </>
  );
}
