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
