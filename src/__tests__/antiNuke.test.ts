import { describe, expect, it } from "vitest";
import { NukeTracker } from "../modules/security/antiNuke/engine.js";
import { defaultGuildConfig } from "../config/guildConfig.js";

const cfg = defaultGuildConfig().antiNuke;
const rec = (executorId = "x", i = 0) => ({ action: "channelDelete" as const, executorId, targetId: `${i}`, targetName: `salon-${i}` });

describe("NukeTracker", () => {
  it("déclenche au seuil, une seule fois par fenêtre", () => {
    const t = new NukeTracker();
    const triggers = Array.from({ length: 8 }, (_, i) => t.record("g", rec("x", i), cfg, 1000 + i * 100).triggered);
    expect(triggers.indexOf(true)).toBe(cfg.thresholds.channelDelete - 1);
    expect(triggers.filter(Boolean)).toHaveLength(1);
  });

  it("compte séparément chaque exécutant", () => {
    const t = new NukeTracker();
    for (let i = 0; i < cfg.thresholds.channelDelete - 1; i++) t.record("g", rec("a", i), cfg, 1000);
    expect(t.record("g", rec("b"), cfg, 1000).triggered).toBe(false);
  });

  it("les actions espacées ne déclenchent rien", () => {
    const t = new NukeTracker();
    for (let i = 0; i < 20; i++) expect(t.record("g", rec("a", i), cfg, i * (cfg.windowSeconds * 1000)).triggered).toBe(false);
  });

  it("conserve la liste des éléments concernés", () => {
    const t = new NukeTracker();
    let v;
    for (let i = 0; i < cfg.thresholds.channelDelete; i++) v = t.record("g", rec("a", i), cfg, 1000);
    expect(v!.recent.map((r) => r.targetName)).toContain("salon-0");
  });
});
