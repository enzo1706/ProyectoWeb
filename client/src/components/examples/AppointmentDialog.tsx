import { useState } from "react";
import { AppointmentDialog } from "../AppointmentDialog";
import { Button } from "@/components/ui/button";

export default function AppointmentDialogExample() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Abrir Dialog</Button>
      <AppointmentDialog
        open={open}
        onOpenChange={setOpen}
        onSave={(appointment) => console.log("Cita creada:", appointment)}
        defaultDate="2025-11-29"
      />
    </>
  );
}
