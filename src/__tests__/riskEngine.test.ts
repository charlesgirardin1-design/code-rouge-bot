import { describe, expect, it } from "vitest";
import { levelForScore, RiskEngine } from "../modules/security/riskEngine.js";
import { defaultGuildConfig } from "../config/guildConfig.js";

const cfg = defaultGuildConfig().riskEngine;

describe("moteur de risque", () => {
  it("convertit le score en niveau (0-10, 11-25, 26-50, 51+)", () => {
    expect(levelForScore(0, cfg.thresholds)).toBe("NORMAL");
    expect(levelForScore(10, cfg.thresholds)).toBe("NORMAL");
    expect(levelForScore(11, cfg.thresholds)).toBe("SURVEILLANCE");
    expect(levelForScore(26, cfg.thresholds)).toBe("REINFORCED");
    expect(levelForScore(51, cfg.thresholds)).toBe("LOCKDOWN");
  });

  it("additionne les points et signale les changements de niveau", () => {
    const r = new RiskEngine();
    expect(r.add("g", 5, cfg, 0).changed).toBe(false);
    const u = r.add("g", 10, cfg, 0);
    expect(u).toMatchObject({ score: 15, previousLevel: "NORMAL", level: "SURVEILLANCE", changed: true });
  });

  it("le score décroît progressivement", () => {
    const r = new RiskEngine();
    r.add("g", 30, cfg, 0);
    expect(r.tick("g", cfg, 60_000).score).toBe(30 - cfg.decayPerMinute);
    const later = r.tick("g", cfg, 20 * 60_000);
    expect(later.score).toBe(0);
    expect(later.level).toBe("NORMAL");
  });

  it("raiseTo impose un niveau minimum", () => {
    const r = new RiskEngine();
    const u = r.raiseTo("g", "LOCKDOWN", cfg, 0);
    expect(u.level).toBe("LOCKDOWN");
    expect(u.score).toBe(cfg.thresholds.lockdown);
  });

  it("les serveurs sont indépendants", () => {
    const r = new RiskEngine();
    r.add("a", 60, cfg, 0);
    expect(r.peek("b").level).toBe("NORMAL");
  });
});
