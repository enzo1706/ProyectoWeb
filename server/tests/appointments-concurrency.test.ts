import "../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, clients, appointments } from "@shared/schema";
import { DatabaseStorage, AppointmentConflictError } from "../storage";

/**
 * Etapa 7.5 — pega contra Postgres real vía `TEST_DATABASE_URL` (mismo criterio que
 * stock-concurrency.test.ts): no hay forma de probar la constraint real de Postgres
 * (`appointments_consultant_active_slot_unique_idx`) contra memoria, el punto es la
 * concurrencia real. Todos los datos son fixtures propios, creados y borrados acá mismo.
 */

const storage = new DatabaseStorage();
let testConsultantId: number;
let testClientId: number;

beforeAll(async () => {
  const [consultant] = await db
    .insert(consultants)
    .values({ businessName: "VITEST appointments-concurrency (borrar si queda huérfano)", currency: "ARS" })
    .returning();
  testConsultantId = consultant.id;

  const [client] = await db
    .insert(clients)
    .values({ consultantId: testConsultantId, phone: "0000000003" })
    .returning();
  testClientId = client.id;
});

afterAll(async () => {
  await db.delete(appointments).where(eq(appointments.consultantId, testConsultantId));
  await db.delete(clients).where(eq(clients.consultantId, testConsultantId));
  await db.delete(consultants).where(eq(consultants.id, testConsultantId));
  await pool.end();
});

function apptOf(date: string, time: string) {
  return { clientId: testClientId, date, time, type: "visita" };
}

describe("Concurrencia real de turnos — Etapa 7.5, contra Postgres real", () => {
  it("23. dos creaciones simultáneas en el MISMO horario exacto: exactamente UNA gana, la otra 409, queda UN solo turno en DB", async () => {
    const results = await Promise.allSettled([
      storage.createAppointment(testConsultantId, apptOf("2027-02-01", "10:00")),
      storage.createAppointment(testConsultantId, apptOf("2027-02-01", "10:00")),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Nunca los dos 200, nunca los dos rechazados — exactamente uno de cada.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AppointmentConflictError);

    const rows = await db
      .select()
      .from(appointments)
      .where(eq(appointments.consultantId, testConsultantId));
    const matchingRows = rows.filter((r) => r.date === "2027-02-01" && r.time === "10:00");
    expect(matchingRows).toHaveLength(1); // nunca 2, nunca 0
  });

  it("dos creaciones simultáneas en horarios que NO chocan: las dos tienen éxito (el índice es por date+time exacto, no bloquea de más)", async () => {
    const results = await Promise.allSettled([
      storage.createAppointment(testConsultantId, apptOf("2027-02-02", "09:00")),
      storage.createAppointment(testConsultantId, apptOf("2027-02-02", "10:00")),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const rows = await db.select().from(appointments).where(eq(appointments.consultantId, testConsultantId));
    expect(rows.filter((r) => r.date === "2027-02-02")).toHaveLength(2);
  });

  it("24. concurrencia de UPDATE: A y B sin conflicto entre sí, se mueven simultáneamente a horarios que SÍ chocan entre ellos -> nunca los dos 200, nunca queda un estado con ambos solapados", async () => {
    const apptA = await storage.createAppointment(testConsultantId, apptOf("2027-02-03", "09:00"));
    const apptB = await storage.createAppointment(testConsultantId, apptOf("2027-02-03", "11:00"));
    if (!apptA || !apptB) throw new Error("setup falló");

    // Ambos intentan moverse al MISMO horario nuevo (10:00) al mismo tiempo.
    const results = await Promise.allSettled([
      storage.updateAppointment(testConsultantId, apptA.id, { ...apptOf("2027-02-03", "10:00") }),
      storage.updateAppointment(testConsultantId, apptB.id, { ...apptOf("2027-02-03", "10:00") }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Garantía real: nunca los dos ganan (eso dejaría dos turnos en el mismo horario). Puede
    // ganar cualquiera de los dos (no se puede predecir el orden real de Postgres) — lo único
    // que importa es que el resultado final en DB sea coherente.
    expect(fulfilled.length).toBeLessThanOrEqual(1);
    if (rejected.length > 0) {
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AppointmentConflictError);
    }

    const rows = await db.select().from(appointments).where(eq(appointments.consultantId, testConsultantId));
    const at1000 = rows.filter((r) => r.date === "2027-02-03" && r.time === "10:00" && r.status !== "cancelada");
    expect(at1000.length).toBeLessThanOrEqual(1); // nunca dos turnos activos en el mismo horario
  });

  it("25. sin deadlock bajo presión: 6 creaciones concurrentes, 3 pares de horarios repetidos -> cada par termina con exactamente 1 ganador, ninguna operación cuelga", async () => {
    const jobs = [
      storage.createAppointment(testConsultantId, apptOf("2027-02-04", "09:00")),
      storage.createAppointment(testConsultantId, apptOf("2027-02-04", "09:00")),
      storage.createAppointment(testConsultantId, apptOf("2027-02-04", "10:00")),
      storage.createAppointment(testConsultantId, apptOf("2027-02-04", "10:00")),
      storage.createAppointment(testConsultantId, apptOf("2027-02-04", "11:00")),
      storage.createAppointment(testConsultantId, apptOf("2027-02-04", "11:00")),
    ];

    const results = await Promise.allSettled(jobs);
    // Ninguna promesa quedó "colgada" — Promise.allSettled ya lo garantiza al resolver, pero
    // además confirmamos que efectivamente 3 ganaron y 3 perdieron (sin deadlock ni timeout).
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(3);
    expect(rejected.every((r) => (r as PromiseRejectedResult).reason instanceof AppointmentConflictError)).toBe(true);

    const rows = await db.select().from(appointments).where(eq(appointments.consultantId, testConsultantId));
    expect(rows.filter((r) => r.date === "2027-02-04")).toHaveLength(3); // uno por horario, nunca duplicado
  });
});
