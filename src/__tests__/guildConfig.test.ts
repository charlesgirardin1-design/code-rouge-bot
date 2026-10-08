import { describe, expect, it } from "vitest";
import { applyConfigPatch, buildPatch, coerceConfigValue, deepMerge, defaultGuildConfig, listConfigLeaves, parseStoredConfig } from "../config/guildConfig.js";

describe("configuration par serveur", () => {
  it("fournit des valeurs par défaut complètes", () => {
    const c = defaultGuildConfig();
    expect(c.antiSpam).toMatchObject({ enabled: true, warnMessages: 5, timeoutMessages: 10, windowSeconds: 5 });
    expect(c.antiRaid).toMatchObject({ surveillanceJoins: 5, reinforcedJoins: 15, lockdownJoins: 30, windowSeconds: 10 });
    expect(c.riskEngine.thresholds).toEqual({ surveillance: 11, reinforced: 26, lockdown: 51 });
    expect(c.moderation.warnThresholds.map((w) => [w.count, w.action])).toEqual([[2, "timeout"], [3, "timeout"], [4, "kick"], [5, "ban"]]);
  });

  it("chaque appel retourne une copie indépendante", () => {
    const a = defaultGuildConfig();
    a.permissions.adminRoleIds.push("123456789012345678");
    expect(defaultGuildConfig().permissions.adminRoleIds).toEqual([]);
  });

  it("répare une configuration stockée partiellement invalide", () => {
    const c = parseStoredConfig({ antiSpam: { enabled: "oui" }, welcome: { enabled: true } });
    expect(c.welcome.enabled).toBe(true);
    expect(c.antiSpam.enabled).toBe(true);
  });

  it("refuse des seuils incohérents", () => {
    const r = applyConfigPatch(defaultGuildConfig(), { riskEngine: { thresholds: { surveillance: 100 } } });
    expect(r.success).toBe(false);
  });

  it("applique un patch valide", () => {
    const r = applyConfigPatch(defaultGuildConfig(), buildPatch("antiSpam.warnMessages", 6));
    expect(r.success && r.data.antiSpam.warnMessages).toBe(6);
  });

  it("refuse un timeout sans durée dans les paliers de warn", () => {
    const r = applyConfigPatch(defaultGuildConfig(), { moderation: { warnThresholds: [{ count: 2, action: "timeout", durationMinutes: null }] } });
    expect(r.success).toBe(false);
  });

  it("deepMerge ignore les clés de pollution de prototype", () => {
    const merged = deepMerge({ a: 1 }, JSON.parse('{"__proto__": {"polluted": true}, "b": 2}')) as Record<string, unknown>;
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(merged["b"]).toBe(2);
  });

  it("liste les clés modifiables avec leur type", () => {
    const leaves = listConfigLeaves();
    expect(leaves.find((l) => l.path === "logs.securityChannelId")?.kind).toBe("snowflake");
    expect(leaves.find((l) => l.path === "permissions.adminRoleIds")?.kind).toBe("snowflakeList");
    expect(leaves.find((l) => l.path === "antiNuke.mitigation")?.options).toEqual(["alert", "strip_roles", "ban"]);
  });

  it("convertit les saisies Discord", () => {
    const leaves = listConfigLeaves();
    const channel = leaves.find((l) => l.path === "logs.securityChannelId")!;
    expect(coerceConfigValue(channel, "<#123456789012345678>")).toEqual({ ok: true, value: "123456789012345678" });
    expect(coerceConfigValue(channel, "none")).toEqual({ ok: true, value: null });
    const roles = leaves.find((l) => l.path === "permissions.adminRoleIds")!;
    expect(coerceConfigValue(roles, "<@&123456789012345678>, 223456789012345678")).toEqual({ ok: true, value: ["123456789012345678", "223456789012345678"] });
    const bool = leaves.find((l) => l.path === "antiSpam.enabled")!;
    expect(coerceConfigValue(bool, "non")).toEqual({ ok: true, value: false });
    expect(coerceConfigValue(bool, "peut-être").ok).toBe(false);
  });
});
