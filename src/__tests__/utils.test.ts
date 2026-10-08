import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration, parseScheduleDate } from "../utils/duration.js";
import { countEmojis, longestCharRun, nameSkeleton, normalizeContent, renderTemplate, similarity } from "../utils/text.js";
import { redactSecrets } from "../utils/logger.js";

describe("durées", () => {
  it("parse les formats courants", () => {
    expect(parseDuration("10m")).toBe(600_000);
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration("2j")).toBe(172_800_000);
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("10x")).toBeNull();
  });
  it("formate", () => expect(formatDuration(5_400_000)).toBe("1h 30min"));
  it("parse les dates de programmation (Europe/Paris)", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(parseScheduleDate("2h", now)?.toISOString()).toBe("2026-10-08T14:00:00.000Z");
    expect(parseScheduleDate("2026-10-09 18:30", now)?.toISOString()).toBe("2026-10-09T16:30:00.000Z");
    expect(parseScheduleDate("09/12/2026 18:30", now)?.toISOString()).toBe("2026-12-09T17:30:00.000Z");
    expect(parseScheduleDate("demain", now)).toBeNull();
  });
});

describe("texte", () => {
  it("similarité", () => {
    expect(similarity("bonjour tout le monde", "bonjour tout le monde")).toBe(1);
    expect(similarity("achetez mes skins 1", "achetez mes skins 2")).toBeGreaterThan(0.85);
    expect(similarity("bonjour", "pizza margherita")).toBeLessThan(0.3);
  });
  it("normalise", () => expect(normalizeContent("  Héllo,   WORLD!! ")).toBe("hello world"));
  it("compte emojis et répétitions", () => {
    expect(countEmojis("salut 😀😀 <:pepe:123456789012345678>")).toBe(3);
    expect(longestCharRun("aaaaab")).toBe(5);
  });
  it("squelette de pseudo", () => {
    expect(nameSkeleton("Raider123")).toBe(nameSkeleton("raider_456"));
  });
  it("template de bienvenue", () => {
    expect(renderTemplate("👋 Bienvenue {user} ! Tu es le {memberCount}e membre de {server}. {inconnu}", { user: "<@1>", memberCount: 42, server: "Code Rouge" })).toBe(
      "👋 Bienvenue <@1> ! Tu es le 42e membre de Code Rouge. {inconnu}",
    );
  });
});

describe("logs", () => {
  it("masque les tokens et URLs de base de données", () => {
    const fakeToken = ["MTIzNDU2Nzg5MDEyMzQ1Njc4", "GabcDE", "abcdefghijklmnopqrstuvwxyz0123456789"].join(".");
    const out = redactSecrets(`token=${fakeToken} db=postgresql://u:p@h:5432/db`);
    expect(out).not.toContain(fakeToken);
    expect(out).not.toContain("u:p@h");
  });
});
