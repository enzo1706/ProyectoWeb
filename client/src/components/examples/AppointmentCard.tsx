import { AppointmentCard } from "../AppointmentCard";
import type { Appointment } from "@shared/schema";

const mockAppointment: Appointment = {
  id: 1,
  consultantId: 1,
  clientName: "Ana Martínez",
  clientId: 1,
  date: "2025-11-29",
  time: "10:00 AM",
  type: "demostracion",
  location: "Casa de la clienta",
  notes: "Interesada en la línea TimeWise",
  status: "pendiente",
};

export default function AppointmentCardExample() {
  return (
    <AppointmentCard
      appointment={mockAppointment}
      onClick={(a) => console.log("Selected appointment:", a.id)}
    />
  );
}
