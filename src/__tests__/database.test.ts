import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectPrisma, getPrisma } from "../database/client.js";
import { GuildConfigService } from "../services/guildConfigService.js";
import { ListService } from "../services/listService.js";
import { StatsService } from "../services/statsService.js";
import { AuditService } from "../services/auditService.js";

/**
 * Tests d'intégration sur une vraie base PostgreSQL (DATABASE_URL, migrations appliquées).
 * Ignorés si aucune base n'est configurée.
 */
const hasDb = Boolean(process.env["DATABASE_URL"]) && process.env["SKIP_DB_TESTS"] !== "1";
const guildId = `9${Date.now()}`.padEnd(18, "0").slice(0, 18);

describe.runIf(hasDb)("base de données", () => {
  const prisma = hasDb ? getPrisma() : (null as never);

  beforeAll(async () => {
    await new GuildConfigService(prisma).ensureGuild({ id: guildId, name: "Serveur de test", ownerId: "111111111111111111" });
  });

  afterAll(async () => {
    await prisma.guild.deleteMany({ where: { id: guildId } });
    await disconnectPrisma();
  });

  it("crée le serveur avec une configuration par défaut", async () => {
    const service = new GuildConfigService(prisma);
    const config = await service.get(guildId);
    expect(config.antiRaid.lockdownJoins).toBe(30);
    expect(await prisma.guildStatistics.findUnique({ where: { guildId } })).not.toBeNull();
  });

  it("valide et persiste un patch, refuse un patch invalide", async () => {
    const service = new GuildConfigService(prisma);
    const ok = await service.update(guildId, { antiSpam: { warnMessages: 6 } }, "111111111111111111");
    expect(ok.ok).toBe(true);
    const fresh = new GuildConfigService(prisma); // nouveau cache → relecture en base
    expect((await fresh.get(guildId)).antiSpam.warnMessages).toBe(6);
    const bad = await service.update(guildId, { antiSpam: { warnMessages: -1 } }, "111111111111111111");
    expect(bad.ok).toBe(false);
  });

  it("isole la configuration de chaque serveur", async () => {
    const service = new GuildConfigService(prisma);
    expect((await service.get("000000000000000001")).antiSpam.warnMessages).toBe(5);
  });

  it("gère les listes blanches / noires sans doublon entre elles", async () => {
    const lists = new ListService(prisma);
    await lists.add("blacklist", guildId, "DOMAIN", "evil.com", "1");
    await lists.add("whitelist", guildId, "DOMAIN", "evil.com", "1");
    const l = await lists.get(guildId);
    expect(l.whitelistDomains.has("evil.com")).toBe(true);
    expect(l.blacklistDomains.has("evil.com")).toBe(false);
    expect(await lists.remove("whitelist", guildId, "DOMAIN", "evil.com")).toBe(true);
  });

  it("écrit les statistiques par lots", async () => {
    const stats = new StatsService(prisma);
    stats.increment(guildId, "spamDetected", 2);
    stats.increment(guildId, "spamDetected");
    expect(stats.pending(guildId).spamDetected).toBe(3);
    await stats.flush();
    expect((await prisma.guildStatistics.findUnique({ where: { guildId } }))?.spamDetected).toBe(3);
  });

  it("numérote les cas de façon atomique", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => prisma.guild.update({ where: { id: guildId }, data: { caseCounter: { increment: 1 } }, select: { caseCounter: true } })),
    );
    expect(new Set(results.map((r) => r.caseCounter)).size).toBe(10);
  });

  it("enregistre le journal d'audit", async () => {
    await new AuditService(prisma).record({ guildId, actorId: "1", actorType: "USER", action: "test.action", details: { ok: true } });
    expect(await prisma.auditLog.count({ where: { guildId, action: "test.action" } })).toBe(1);
  });
});
