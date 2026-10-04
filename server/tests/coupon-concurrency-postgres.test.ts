import "../load-env";
import { describe, it, expect, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { testDb as db, testPool as pool } from "../test-db";
import { consultants, coupons, couponRedemptions, subscriptions } from "@shared/schema";
import { DatabaseStorage } from "../storage";

/**
 * Prompt U — condición de carrera real de reservas de cupón, sobre Postgres de verdad (no se
 * puede demostrar con MemoryStorage: el punto es el `FOR UPDATE` del cupón y el `unique` de
 * (couponId, consultantId) de Postgres, mismo criterio que payments-recurring-postgres.test.ts
 * para `applyApprovedPayment`).
 */

const storage = new DatabaseStorage();
const createdConsultantIds: number[] = [];
const createdCouponIds: number[] = [];

async function fixtureConsultant(label: string): Promise<number> {
  const [consultant] = await db
    .insert(consultants)
    .values({ businessName: `VITEST mp-u ${label} (borrar si queda huérfano)`, currency: "ARS" })
    .returning();
  createdConsultantIds.push(consultant.id);
  const now = new Date();
  await storage.createTrialSubscription(consultant.id, now, new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000));
  return consultant.id;
}

async function fixtureCoupon(code: string, maxUses: number | null): Promise<number> {
  const coupon = await storage.createCoupon({
    code,
    discountType: "percentage",
    discountValue: 50,
    duration: "forever",
    durationMonths: null,
    maxUses,
    expiresAt: null,
    createdByAdminId: null,
  });
  createdCouponIds.push(coupon.id);
  return coupon.id;
}

const reserveInput = { discountType: "percentage" as const, discountValue: 50, duration: "forever" as const, durationMonths: null };

afterAll(async () => {
  if (createdConsultantIds.length > 0) {
    await db.delete(couponRedemptions).where(inArray(couponRedemptions.consultantId, createdConsultantIds));
    await db.delete(subscriptions).where(inArray(subscriptions.consultantId, createdConsultantIds));
    await db.delete(consultants).where(inArray(consultants.id, createdConsultantIds));
  }
  if (createdCouponIds.length > 0) {
    await db.delete(coupons).where(inArray(coupons.id, createdCouponIds));
  }
  await pool.end();
});

describe("Prompt U — reservas de cupón sobre Postgres real", () => {
  it("1. la misma consultora reservando el mismo cupón dos veces en paralelo: una sola fila, la otra 'already_used'", async () => {
    const consultantId = await fixtureConsultant("doble-reserva");
    const couponId = await fixtureCoupon(`VITESTDUP${Date.now()}`, null);

    const results = await Promise.all([
      storage.reserveCouponForConsultant(couponId, consultantId, reserveInput, 15 * 60 * 1000),
      storage.reserveCouponForConsultant(couponId, consultantId, reserveInput, 15 * 60 * 1000),
    ]);

    expect(results.map((r) => r.outcome).sort()).toEqual(["already_used", "reserved"]);
    const rows = await db.select().from(couponRedemptions).where(inArray(couponRedemptions.consultantId, [consultantId]));
    expect(rows).toHaveLength(1);
  });

  it("2. maxUses=1: dos consultoras distintas reservando en paralelo — exactamente una gana, la otra 'limit_reached'", async () => {
    const a = await fixtureConsultant("limite-a");
    const b = await fixtureConsultant("limite-b");
    const couponId = await fixtureCoupon(`VITESTLIMIT${Date.now()}`, 1);

    const results = await Promise.all([
      storage.reserveCouponForConsultant(couponId, a, reserveInput, 15 * 60 * 1000),
      storage.reserveCouponForConsultant(couponId, b, reserveInput, 15 * 60 * 1000),
    ]);

    expect(results.map((r) => r.outcome).sort()).toEqual(["limit_reached", "reserved"]);
    const rows = await db.select().from(couponRedemptions).where(inArray(couponRedemptions.couponId, [couponId]));
    expect(rows).toHaveLength(1);
  });

  it("3. maxUses=3 con 5 intentos en paralelo: exactamente 3 reservados, 2 'limit_reached' — nunca más de 3 filas", async () => {
    const consultantIds = await Promise.all(
      Array.from({ length: 5 }, (_, i) => fixtureConsultant(`limite3-${i}`)),
    );
    const couponId = await fixtureCoupon(`VITESTLIMIT3_${Date.now()}`, 3);

    const results = await Promise.all(
      consultantIds.map((id) => storage.reserveCouponForConsultant(couponId, id, reserveInput, 15 * 60 * 1000)),
    );

    const reserved = results.filter((r) => r.outcome === "reserved");
    const limited = results.filter((r) => r.outcome === "limit_reached");
    expect(reserved).toHaveLength(3);
    expect(limited).toHaveLength(2);
    const rows = await db.select().from(couponRedemptions).where(inArray(couponRedemptions.couponId, [couponId]));
    expect(rows).toHaveLength(3);
  });

  it("4. confirmar una redención reservada deja status='confirmed' y discountEndsAt según la duración", async () => {
    const consultantId = await fixtureConsultant("confirmar");
    const couponId = await fixtureCoupon(`VITESTCONFIRM${Date.now()}`, null);
    const reserved = await storage.reserveCouponForConsultant(
      couponId,
      consultantId,
      { discountType: "percentage", discountValue: 20, duration: "months", durationMonths: 1 },
      15 * 60 * 1000,
    );
    expect(reserved.outcome).toBe("reserved");

    const now = new Date();
    const confirmed = await storage.confirmCouponRedemption(consultantId, now);
    expect(confirmed?.status).toBe("confirmed");
    expect(confirmed?.discountEndsAt).not.toBeNull();
    expect(confirmed!.discountEndsAt!.getTime()).toBe(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  });
});
