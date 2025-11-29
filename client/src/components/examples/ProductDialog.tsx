import { useState } from "react";
import { ProductDialog } from "../ProductDialog";
import { Button } from "@/components/ui/button";

export default function ProductDialogExample() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Abrir Dialog</Button>
      <ProductDialog
        open={open}
        onOpenChange={setOpen}
        product={null}
        onSave={(product) => console.log("Producto guardado:", product)}
      />
    </>
  );
}
