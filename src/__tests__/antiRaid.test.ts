import { describe, expect, it } from "vitest";
import { RaidDetector } from "../modules/security/antiRaid/engine.js";
import { defaultGuildConfig } from "../config/guildConfig.js";

const config = defaultGuildConfig();
const DAY = 86_400_000;
const join = (d: RaidDetector, i: number, ts: number, over: { username?: string; age?: number } = {}) =>
  d.recordJoin({ guildId: "g", userId: `u${i}`, username: over.username ?? `user_${["alpha", "bravo", "charlie", "delta", "echo", "fox", "golf"][i % 7]}${i}`, accountCreatedAt: ts - (over.age ?? 400 * DAY), hasAvatar: true, timestamp: ts }, config.antiRaid, config.riskEngine.points);

describe("RaidDetector", () => {
  it("une arrivée isolée d'un compte récent ne génère pas de points de raid", () => {
    const d = new RaidDetector();
    const a = join(d, 0, 1_000_000, { age: DAY / 2 });
    expect(a.isNewAccount).toBe(true);
    expect(a.riskPoints).toBe(0);
    expect(a.suggestedLevel).toBe("NORMAL");
  });

  it("applique les seuils 5/15/30 arrivées en 10 s", () => {
    const d = new RaidDetector();
    const levels: string[] = [];
    for (let i = 0; i < 30; i++) levels.push(join(d, i, 1_000_000 + i * 200).suggestedLevel);
    expect(levels[3]).toBe("NORMAL");
    expect(levels[4]).toBe("SURVEILLANCE");
    expect(levels[14]).toBe("REINFORCED");
    expect(levels[29]).toBe("LOCKDOWN");
  });

  it("la fenêtre est glissante", () => {
    const d = new RaidDetector();
    for (let i = 0; i < 30; i++) expect(join(d, i, 1_000_000 + i * 3000).suggestedLevel).not.toBe("REINFORCED");
  });

  it("détecte une vague de pseudos similaires", () => {
    const d = new RaidDetector();
    let last;
    for (let i = 0; i < 3; i++) last = join(d, i, 1_000_000 + i * 100, { username: `raider${100 + i}` });
    expect(last!.similarCount).toBe(3);
    expect(last!.wave).toBe(true);
    expect(last!.riskPoints).toBeGreaterThanOrEqual(config.riskEngine.points.joinWave);
  });

  it("mémorise l'heure d'arrivée pour détecter l'activité immédiate", () => {
    const d = new RaidDetector();
    join(d, 1, 1_000_000);
    expect(d.timeSinceJoin("g", "u1", 1_005_000)).toBe(5000);
    expect(d.timeSinceJoin("g", "inconnu", 1_005_000)).toBeNull();
  });
});
