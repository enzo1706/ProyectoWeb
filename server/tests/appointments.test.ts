import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

process.env.NODE_ENV = "test";
process.env.DATABASE_MODE = "memory";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "vitest-only-secret-not-real";

let httpServer: Server;
let baseUrl: string;
let cookie: string;
let clientId: number;

async function api(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeAll(async () => {
  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const { storage } = await import("../storage");
  const user = await storage.createUser({
    username: `vitest_appts_${Date.now()}`,
    password: "vitest-test-password-123",
    role: "consultant",
    status: true,
  });
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: "vitest-test-password-123" }),
  });
  cookie = loginRes.headers.get("set-cookie")!.split(";")[0];

  const clientRes = await api("POST", "/api/clients", { name: "Clienta VITEST Appointments", phone: "9990000004" });
  clientId = (await clientRes.json()).id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("POST /api/appointments — creación", () => {
  it("happy path: crea la cita y persiste exactamente los valores enviados", async () => {
    const res = await api("POST", "/api/appointments", {
      clientId,
      date: "2026-12-10",
      time: "15:30",
      type: "visita",
      location: "Casa de la clienta",
      notes: "Llevar catálogo",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.date).toBe("2026-12-10");
    expect(created.time).toBe("15:30");
    expect(created.type).toBe("visita");
    expect(created.status).toBe("pendiente");

    const list = await (await api("GET", "/api/appointments?start=2026-12-01&end=2026-12-31")).json();
    const found = list.find((a: any) => a.id === created.id);
    expect(found).toBeDefined();
    expect(found.location).toBe("Casa de la clienta");
  });

  it("404 sin persistir: cliente inexistente", async () => {
    const res = await api("POST", "/api/appointments", { clientId: 999999, date: "2026-12-10", time: "10:00", type: "visita" });
    expect(res.status).toBe(404);
  });

  it("rechaza sin persistir: falta 'date' (campo obligatorio)", async () => {
    const res = await api("POST", "/api/appointments", { clientId, time: "10:00", type: "visita" });
    expect(res.status).toBe(400);
  });

  it("rechaza sin persistir: falta 'type'", async () => {
    const res = await api("POST", "/api/appointments", { clientId, date: "2026-12-10", time: "10:00" });
    expect(res.status).toBe(400);
  });

  it("rechaza sin persistir: body vacío", async () => {
    const res = await api("POST", "/api/appointments", {});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/appointments — validación de rango", () => {
  it("400 si faltan start/end", async () => {
    const res = await api("GET", "/api/appointments");
    expect(res.status).toBe(400);
  });

  it("400 si end no es posterior a start", async () => {
    const res = await api("GET", "/api/appointments?start=2026-12-10&end=2026-12-10");
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/appointments/:id — edición completa", () => {
  let appointmentId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/appointments", { clientId, date: "2026-12-05", time: "09:00", type: "visita" });
    appointmentId = (await res.json()).id;
  });

  it("happy path: cambia fecha/hora/tipo y queda persistido", async () => {
    const res = await api("PATCH", `/api/appointments/${appointmentId}`, {
      clientId,
      date: "2026-12-20",
      time: "16:00",
      type: "entrega",
      notes: "Reprogramada",
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.date).toBe("2026-12-20");
    expect(updated.time).toBe("16:00");
    expect(updated.type).toBe("entrega");

    const list = await (await api("GET", "/api/appointments?start=2026-12-01&end=2026-12-31")).json();
    const found = list.find((a: any) => a.id === appointmentId);
    expect(found.date).toBe("2026-12-20");
    expect(found.notes).toBe("Reprogramada");
  });

  it("404 para una cita inexistente", async () => {
    const res = await api("PATCH", "/api/appointments/999999", { clientId, date: "2026-01-01", time: "10:00", type: "visita" });
    expect(res.status).toBe(404);
  });

  it("rechaza sin mutar: cliente inexistente en la edición", async () => {
    const before = (await (await api("GET", "/api/appointments?start=2026-12-01&end=2026-12-31")).json()).find((a: any) => a.id === appointmentId);
    const res = await api("PATCH", `/api/appointments/${appointmentId}`, { clientId: 999999, date: "2026-01-01", time: "10:00", type: "visita" });
    expect(res.status).toBe(400);
    const after = (await (await api("GET", "/api/appointments?start=2026-12-01&end=2026-12-31")).json()).find((a: any) => a.id === appointmentId);
    expect(after.date).toBe(before.date);
  });
});

describe("PATCH /api/appointments/:id/status", () => {
  let appointmentId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/appointments", { clientId, date: "2026-12-06", time: "09:00", type: "visita" });
    appointmentId = (await res.json()).id;
  });

  it("happy path: cambia el estado y persiste", async () => {
    const res = await api("PATCH", `/api/appointments/${appointmentId}/status`, { status: "confirmada" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("confirmada");

    const list = await (await api("GET", "/api/appointments?start=2026-12-01&end=2026-12-31")).json();
    expect(list.find((a: any) => a.id === appointmentId).status).toBe("confirmada");
  });

  it("rechaza enum inválido, sin mutar", async () => {
    const res = await api("PATCH", `/api/appointments/${appointmentId}/status`, { status: "en_camino" });
    expect(res.status).toBe(400);
    const list = await (await api("GET", "/api/appointments?start=2026-12-01&end=2026-12-31")).json();
    expect(list.find((a: any) => a.id === appointmentId).status).toBe("confirmada");
  });

  it("404 para una cita inexistente", async () => {
    const res = await api("PATCH", "/api/appointments/999999/status", { status: "completada" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/appointments/:id", () => {
  let appointmentId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/appointments", { clientId, date: "2026-12-07", time: "09:00", type: "visita" });
    appointmentId = (await res.json()).id;
  });

  it("happy path: elimina y deja de aparecer en el rango", async () => {
    const res = await api("DELETE", `/api/appointments/${appointmentId}`);
    expect(res.status).toBe(204);

    const list = await (await api("GET", "/api/appointments?start=2026-12-01&end=2026-12-31")).json();
    expect(list.some((a: any) => a.id === appointmentId)).toBe(false);
  });

  it("404 al eliminar de nuevo la misma cita (ya no existe)", async () => {
    const res = await api("DELETE", `/api/appointments/${appointmentId}`);
    expect(res.status).toBe(404);
  });

  it("404 para una cita inexistente", async () => {
    const res = await api("DELETE", "/api/appointments/999999");
    expect(res.status).toBe(404);
  });
});

describe("Conflicto de horarios — Etapa 7.5", () => {
  // Fecha propia de este describe (no compartida con los demás) para no chocar con turnos
  // creados por otros describes de este archivo, que reusan el mismo consultantId/cookie.
  const DAY = "2027-01-10";
  const OTHER_DAY = "2027-01-11";
  let clientBId: number;

  beforeAll(async () => {
    const res = await api("POST", "/api/clients", { name: "Clienta B VITEST Appointments", phone: "9990000005" });
    clientBId = (await res.json()).id;
  });

  it("1. crear un turno sin conflicto: éxito normal", async () => {
    const res = await api("POST", "/api/appointments", { clientId, date: DAY, time: "10:00", type: "visita" });
    expect(res.status).toBe(201);
  });

  it("2. crear un turno en el MISMO horario exacto (mismo consultantId+date+time): 409, sin duplicar", async () => {
    const res = await api("POST", "/api/appointments", { clientId, date: DAY, time: "10:00", type: "entrega" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/ya existe un turno/i);

    const list = await (await api("GET", `/api/appointments?start=${DAY}&end=${OTHER_DAY}`)).json();
    expect(list.filter((a: any) => a.time === "10:00")).toHaveLength(1); // nunca dos en el mismo horario
  });

  it("3. crear un turno en un horario DISTINTO el mismo día: no es conflicto (el modelo es punto-a-punto, sin duración)", async () => {
    const res = await api("POST", "/api/appointments", { clientId, date: DAY, time: "11:00", type: "visita" });
    expect(res.status).toBe(201);
  });

  it("4/5. mismo horario (10:00) mismo día -> conflicto; mismo horario OTRO día -> no hay conflicto", async () => {
    const conflictRes = await api("POST", "/api/appointments", { clientId, date: DAY, time: "10:00", type: "visita" });
    expect(conflictRes.status).toBe(409);

    const otherDayRes = await api("POST", "/api/appointments", { clientId, date: OTHER_DAY, time: "10:00", type: "visita" });
    expect(otherDayRes.status).toBe(201); // misma hora, fecha distinta -> nunca conflicto
  });

  it("6. dos turnos del MISMO cliente en horarios que chocan: también es conflicto (la ocupación es de la agenda, no del cliente)", async () => {
    const res = await api("POST", "/api/appointments", { clientId, date: DAY, time: "10:00", type: "visita" });
    expect(res.status).toBe(409);
  });

  it("7. dos turnos de clientes DISTINTOS en el mismo horario: también es conflicto (no depende de clientId)", async () => {
    const res = await api("POST", "/api/appointments", { clientId: clientBId, date: DAY, time: "10:00", type: "visita" });
    expect(res.status).toBe(409);
  });

  it("8. un turno CANCELADO no bloquea ese horario para uno nuevo", async () => {
    const createRes = await api("POST", "/api/appointments", { clientId, date: DAY, time: "14:00", type: "visita" });
    const toCancel = await createRes.json();
    await api("PATCH", `/api/appointments/${toCancel.id}/status`, { status: "cancelada" });

    const res = await api("POST", "/api/appointments", { clientId: clientBId, date: DAY, time: "14:00", type: "entrega" });
    expect(res.status).toBe(201); // el horario quedó libre porque el original está cancelado
  });

  it("9. actualizar un turno SIN cambiar nada (mismo horario) nunca se detecta a sí mismo como conflicto", async () => {
    const createRes = await api("POST", "/api/appointments", { clientId, date: DAY, time: "16:00", type: "visita" });
    const appt = await createRes.json();

    const res = await api("PATCH", `/api/appointments/${appt.id}`, { clientId, date: DAY, time: "16:00", type: "entrega" });
    expect(res.status).toBe(200); // excluye su propio id de la comprobación
  });

  it("10. actualizar un turno para que choque con OTRO existente: 409, el turno editado NO se mueve", async () => {
    const apptARes = await api("POST", "/api/appointments", { clientId, date: DAY, time: "17:00", type: "visita" });
    const apptA = await apptARes.json();
    await api("POST", "/api/appointments", { clientId: clientBId, date: DAY, time: "18:00", type: "visita" });

    const res = await api("PATCH", `/api/appointments/${apptA.id}`, { clientId, date: DAY, time: "18:00", type: "visita" });
    expect(res.status).toBe(409);

    const list = await (await api("GET", `/api/appointments?start=${DAY}&end=${OTHER_DAY}`)).json();
    expect(list.find((a: any) => a.id === apptA.id).time).toBe("17:00"); // sigue en su horario original, nunca se movió
  });

  it("12. tenant isolation: el horario de la consultora A no bloquea ni es visible para la consultora B", async () => {
    const otherUser = await (
      await import("../storage")
    ).storage.createUser({
      username: `vitest_appts_tenant_b_${Date.now()}`,
      password: "vitest-test-password-123",
      role: "consultant",
      status: true,
    });
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: otherUser.username, password: "vitest-test-password-123" }),
    });
    const cookieB = loginRes.headers.get("set-cookie")!.split(";")[0];

    const clientForBRes = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieB },
      body: JSON.stringify({ name: "Clienta de B", phone: "9990000006" }),
    });
    const clientForB = await clientForBRes.json();

    // Mismo día+hora EXACTOS que ya están ocupados en la consultora A (ver test 1) — para B
    // debe ser un horario libre, porque el conflicto nunca cruza tenants.
    const res = await fetch(`${baseUrl}/api/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieB },
      body: JSON.stringify({ clientId: clientForB.id, date: DAY, time: "10:00", type: "visita" }),
    });
    expect(res.status).toBe(201); // nunca 409 — el turno de A es invisible para B
  });
});
