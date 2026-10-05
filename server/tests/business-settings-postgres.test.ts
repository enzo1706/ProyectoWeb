import "../load-env";
import { describe, it, expect, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, orderDiscountLog } from "@shared/schema";
import { DatabaseStorage } from "../storage";

/**
 * Prompt 1 — mismas reglas que business-settings.test.ts (modo memoria), pero contra Postgres
 * real: confirma que DatabaseStorage (no solo MemoryStorage) persiste las 3 columnas nuevas de
 * `consultants` y el nuevo `order_discount_log` correctamente.
 */

const storage = new DatabaseStorage();
const createdConsultantIds: number[] = [];

async function fixtureConsultant(label: string): Promise<number> {
  const [consultant] = await db
    .insert(consultants)
    .values({ businessName: `VITEST prompt1 ${label} (borrar si queda huérfano)`, currency: "ARS" })
    .returning();
  createdConsultantIds.push(consultant.id);
  return consultant.id;
}

afterAll(async () => {
  if (createdConsultantIds.length > 0) {
    await db.delete(orderDiscountLog).where(inArray(orderDiscountLog.consultantId, createdConsultantIds));
    await db.delete(consultants).where(inArray(consultants.id, createdConsultantIds));
  }
  await pool.end();
});

describe("Prompt 1 — Configuración sobre Postgres real", () => {
  it("updateBusinessSettings persiste los días de pedido y el % de Ingresos Brutos", async () => {
    const consultantId = await fixtureConsultant("settings");
    const updated = await storage.updateBusinessSettings(consultantId, {
      businessName: "Negocio de prueba",
      currency: "ARS",
      orderReminderDay1: 5,
      orderReminderDay2: 20,
      grossIncomeTaxPercentTenths: 35,
    });
    expect(updated?.orderReminderDay1).toBe(5);
    expect(updated?.orderReminderDay2).toBe(20);
    expect(updated?.grossIncomeTaxPercentTenths).toBe(35);

    const settings = await storage.getBusinessSettings(consultantId);
    expect(settings?.orderReminderDay1).toBe(5);
    expect(settings?.orderReminderDay2).toBe(20);
  });

  it("createOrderDiscountLogEntry + listOrderDiscountLogSince + getLatestOrderDiscountLogEntry", async () => {
    const consultantId = await fixtureConsultant("log");
    await storage.createOrderDiscountLogEntry(consultantId, { discountPercent: 35, publicValueArs: 10000 });
    await storage.createOrderDiscountLogEntry(consultantId, { discountPercent: 45, publicValueArs: 20000 });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await storage.listOrderDiscountLogSince(consultantId, since);
    expect(recent).toHaveLength(2);

    const latest = await storage.getLatestOrderDiscountLogEntry(consultantId);
    expect(latest?.discountPercent).toBe(45);
    expect(latest?.publicValueArs).toBe(20000);
  });

  it("listOrderDiscountLogSince no mezcla pedidos de otra consultora (aislamiento por tenant)", async () => {
    const consultantA = await fixtureConsultant("tenant-a");
    const consultantB = await fixtureConsultant("tenant-b");
    await storage.createOrderDiscountLogEntry(consultantA, { discountPercent: 35, publicValueArs: 10000 });
    await storage.createOrderDiscountLogEntry(consultantB, { discountPercent: 45, publicValueArs: 20000 });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const forA = await storage.listOrderDiscountLogSince(consultantA, since);
    expect(forA).toHaveLength(1);
    expect(forA[0].discountPercent).toBe(35);
  });
});
