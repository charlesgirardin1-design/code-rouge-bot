import { describe, expect, it } from "vitest";
import { AntiSpamEngine, type SpamMessageInput } from "../modules/security/antiSpam/engine.js";
import { defaultGuildConfig } from "../config/guildConfig.js";

const cfg = defaultGuildConfig().antiSpam;
let n = 0;
const msg = (over: Partial<SpamMessageInput> = {}): SpamMessageInput => ({
  guildId: "g",
  userId: "u",
  channelId: "c",
  messageId: `m${n++}`,
  content: `message numéro ${n} avec du contenu varié ${Math.random()}`,
  mentionCount: 0,
  linkCount: 0,
  timestamp: 0,
  ...over,
});

describe("AntiSpamEngine", () => {
  it("ne sanctionne jamais un message normal isolé", () => {
    const e = new AntiSpamEngine();
    expect(e.evaluate(msg({ timestamp: 1000 }), cfg).action).toBe("none");
  });

  it("5 messages en 5 s → avertissement, 10 → timeout", () => {
    const e = new AntiSpamEngine();
    const actions: string[] = [];
    for (let i = 0; i < 10; i++) actions.push(e.evaluate(msg({ timestamp: 1000 + i * 300 }), cfg).action);
    expect(actions.slice(0, 4)).toEqual(["none", "none", "none", "none"]);
    expect(actions[4]).toBe("warn");
    expect(actions[9]).toBe("timeout");
  });

  it("un flood extrême donne un timeout long", () => {
    const e = new AntiSpamEngine();
    const strict = { ...cfg, timeoutMessages: 50, severeMessages: 60, warnMessages: 40 };
    let last = "none";
    for (let i = 0; i < 60; i++) last = e.evaluate(msg({ timestamp: 1000 + i * 50 }), strict).action;
    expect(last).toBe("severe_timeout");
  });

  it("utilise une fenêtre glissante (messages espacés = aucune action)", () => {
    const e = new AntiSpamEngine();
    for (let i = 0; i < 30; i++) expect(e.evaluate(msg({ timestamp: 1000 + i * 2000 }), cfg).action).toBe("none");
  });

  it("détecte les messages identiques et supprime le doublon", () => {
    const e = new AntiSpamEngine();
    const results = [0, 1, 2, 3].map((i) => e.evaluate(msg({ content: "rejoignez mon serveur !!!", timestamp: 1000 + i * 6000 }), cfg));
    expect(results[3]!.violations).toContain("DUPLICATE");
    expect(results[3]!.toDelete).toHaveLength(1);
  });

  it("détecte les messages presque identiques", () => {
    const e = new AntiSpamEngine();
    const texts = ["achetez mes skins pas cher 1", "achetez mes skins pas cher 2", "achetez mes skins pas cher 3", "achetez mes skins pas cher 4"];
    const last = texts.map((t, i) => e.evaluate(msg({ content: t, timestamp: 1000 + i * 6000 }), cfg)).at(-1)!;
    expect(last.violations).toContain("NEAR_DUPLICATE");
  });

  it("mentions excessives dans un message → suppression", () => {
    const e = new AntiSpamEngine();
    const v = e.evaluate(msg({ mentionCount: 8, timestamp: 1000 }), cfg);
    expect(v.violations).toContain("MASS_MENTION");
    expect(v.toDelete).toHaveLength(1);
    expect(v.action).toBe("warn");
  });

  it("caractères répétés et emojis", () => {
    const e = new AntiSpamEngine();
    expect(e.evaluate(msg({ content: "a".repeat(40), timestamp: 1000 }), cfg).violations).toContain("REPEATED_CHARS");
    expect(e.evaluate(msg({ userId: "u2", content: "😀".repeat(30), timestamp: 1000 }), cfg).violations).toContain("EMOJI_FLOOD");
  });

  it("la tolérance transforme les récidives en timeout", () => {
    const e = new AntiSpamEngine();
    const first = e.evaluate(msg({ content: "b".repeat(40), timestamp: 1000 }), cfg);
    const second = e.evaluate(msg({ content: "c".repeat(40), timestamp: 60_000 }), cfg);
    expect(first.action).toBe("warn");
    expect(second.action).toBe("timeout");
  });

  it("les utilisateurs sont isolés", () => {
    const e = new AntiSpamEngine();
    for (let i = 0; i < 4; i++) e.evaluate(msg({ userId: "a", timestamp: 1000 + i * 100 }), cfg);
    expect(e.evaluate(msg({ userId: "b", timestamp: 1500 }), cfg).action).toBe("none");
  });

  it("pas de double sanction pour la même rafale, mais nettoyage des messages", () => {
    const e = new AntiSpamEngine();
    const verdicts = Array.from({ length: 12 }, (_, i) => e.evaluate(msg({ timestamp: 1000 + i * 200 }), cfg));
    expect(verdicts.filter((v) => v.action === "timeout")).toHaveLength(1);
    expect(verdicts[10]!.action).toBe("none");
    expect(verdicts[10]!.toDelete).toHaveLength(1);
  });

  it("une récidive après un timeout donne un timeout long", () => {
    const e = new AntiSpamEngine();
    for (let i = 0; i < 10; i++) e.evaluate(msg({ timestamp: 1000 + i * 200 }), cfg);
    const second = Array.from({ length: 10 }, (_, i) => e.evaluate(msg({ timestamp: 120_000 + i * 200 }), cfg).action);
    expect(second).toContain("severe_timeout");
    expect(second).not.toContain("timeout");
  });
});
