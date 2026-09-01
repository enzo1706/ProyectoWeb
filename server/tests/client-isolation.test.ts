import "../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { db, pool } from "../db";
import { consultants, users, clients, subscriptions } from "@shared/schema";
import { DatabaseStorage } from "../storage";

/**
 * Pega contra Postgres real y contra la app HTTP real (login + PATCH), para probar el
 * camino completo que de verdad usa el navegador — no solo la capa de storage. Dos
 * consultoras + una clienta de prueba, todo creado y borrado acá; nunca toca cuentas,
 * consultoras ni clientas reales.
 */

process.env.NODE_ENV = "test";

const storage = new DatabaseStorage();
let httpServer: Server;
let baseUrl: string;

let userAId: number;
let userBId: number;
let consultantAId: number;
let consultantBId: number;
let clientOfAId: number;

const USERNAME_A = `vitest_iso_a_${Date.now()}`;
const USERNAME_B = `vitest_iso_b_${Date.now()}`;
const PASSWORD = "vitest-test-password-123";

beforeAll(async () => {
  const userA = await storage.createUser({ username: USERNAME_A, password: PASSWORD, role: "consultant", status: true, consultantId: null });
  const userB = await storage.createUser({ username: USERNAME_B, password: PASSWORD, role: "consultant", status: true, consultantId: null });
  userAId = userA.id;
  userBId = userB.id;
  consultantAId = userA.consultantId!;
  consultantBId = userB.consultantId!;

  const [client] = await db.insert(clients).values({ consultantId: consultantAId, phone: "0000000002" }).returning();
  clientOfAId = client.id;

  const { createApp } = await import("../app");
  const result = await createApp();
  httpServer = result.httpServer;
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await db.delete(clients).where(eq(clients.id, clientOfAId));
  await db.delete(users).where(eq(users.id, userAId));
  await db.delete(users).where(eq(users.id, userBId));
  await db.delete(subscriptions).where(eq(subscriptions.consultantId, consultantAId));
  await db.delete(subscriptions).where(eq(subscriptions.consultantId, consultantBId));
  await db.delete(consultants).where(eq(consultants.id, consultantAId));
  await db.delete(consultants).where(eq(consultants.id, consultantBId));
  await pool.end();
});

async function loginAs(username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

describe("Aislamiento de consultantId en clientas", () => {
  it("una consultora no puede reasignar su clienta a otro tenant mandando consultantId en el body", async () => {
    const cookie = await loginAs(USERNAME_A);

    const res = await fetch(`${baseUrl}/api/clients/${clientOfAId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "Intento de reasignación", consultantId: consultantBId }),
    });

    // El campo extra se ignora (Zod lo excluye del schema), el resto del update sí aplica.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Intento de reasignación");

    const [clientRow] = await db.select().from(clients).where(eq(clients.id, clientOfAId));
    expect(clientRow.consultantId).toBe(consultantAId);
    expect(clientRow.consultantId).not.toBe(consultantBId);
  });

  it("la consultora B no puede editar una clienta de la consultora A (404, no 200)", async () => {
    const cookie = await loginAs(USERNAME_B);

    const res = await fetch(`${baseUrl}/api/clients/${clientOfAId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "Edición cross-tenant" }),
    });

    expect(res.status).toBe(404);
  });
});
