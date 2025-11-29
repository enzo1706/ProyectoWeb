import { AppointmentCard, type Appointment } from "../AppointmentCard";

const mockAppointment: Appointment = {
  id: "1",
  clientName: "Ana Martínez",
  clientId: "c1",
  date: "2025-11-29",
  time: "10:00 AM",
  type: "demostracion",
  location: "Casa de la clienta",
  notes: "Interesada en la línea TimeWise",
};

export default function AppointmentCardExample() {
  return (
    <AppointmentCard
      appointment={mockAppointment}
      onClick={(a) => console.log("Selected appointment:", a.id)}
    />
  );
}
