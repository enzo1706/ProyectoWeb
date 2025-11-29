import { useState } from "react";
import { SaleDialog } from "../SaleDialog";
import { Button } from "@/components/ui/button";

export default function SaleDialogExample() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Abrir Dialog</Button>
      <SaleDialog
        open={open}
        onOpenChange={setOpen}
        onSave={(sale) => console.log("Venta registrada:", sale)}
      />
    </>
  );
}
