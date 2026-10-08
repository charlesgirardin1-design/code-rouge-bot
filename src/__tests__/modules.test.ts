import { describe, expect, it } from "vitest";
import { computeAltRisk } from "../modules/security/antiAlt/score.js";
import { BotAdditionTracker, listDangerousPermissions } from "../modules/security/antiBot/analyzer.js";
import { resolveWarnEscalation } from "../modules/moderation/escalation.js";
import { runSimulation } from "../modules/security/simulation.js";
import { buildTranscriptHtml, escapeHtml } from "../modules/tickets/transcript.js";
import { announcementInputSchema, buildAnnouncementMessage } from "../modules/announcements/announcementService.js";
import { defaultGuildConfig } from "../config/guildConfig.js";
import { DiscordPerm } from "../permissions/levels.js";

const config = defaultGuildConfig();
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

describe("anti-alt", () => {
  const base = { hasAvatar: true, username: "Camille", duringRaid: false, similarToRecent: false, immediateActivity: false, now: NOW };
  it("un compte ancien est à faible risque", () => {
    expect(computeAltRisk({ ...base, accountCreatedAt: NOW - 400 * DAY }, config.antiAlt).level).toBe("LOW");
  });
  it("un compte récent seul n'est pas considéré malveillant (pas de risque élevé)", () => {
    expect(computeAltRisk({ ...base, accountCreatedAt: NOW - 2 * 3_600_000 }, config.antiAlt).level).not.toBe("HIGH");
  });
  it("le cumul de signaux mène à un risque élevé", () => {
    const r = computeAltRisk({ ...base, accountCreatedAt: NOW - 10 * 60_000, hasAvatar: false, duringRaid: true, immediateActivity: true }, config.antiAlt);
    expect(r.level).toBe("HIGH");
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("anti-bot", () => {
  it("liste les permissions dangereuses", () => {
    expect(listDangerousPermissions(DiscordPerm.Administrator | DiscordPerm.BanMembers)).toEqual(["Administrateur", "Bannir des membres"]);
  });
  it("Administrateur → critique ; ajout massif détecté", () => {
    const t = new BotAdditionTracker();
    expect(t.analyze("g", DiscordPerm.Administrator, config.antiBot, 0).severity).toBe("CRITICAL");
    t.analyze("g", 0n, config.antiBot, 1);
    t.analyze("g", 0n, config.antiBot, 2);
    const fourth = t.analyze("g", 0n, config.antiBot, 3);
    expect(fourth.tooManyBots).toBe(true);
  });
});

describe("escalade des avertissements", () => {
  const t = config.moderation.warnThresholds;
  it("suit les paliers par défaut", () => {
    expect(resolveWarnEscalation(1, t)).toBeNull();
    expect(resolveWarnEscalation(2, t)).toMatchObject({ action: "timeout", durationMinutes: 10 });
    expect(resolveWarnEscalation(3, t)).toMatchObject({ action: "timeout", durationMinutes: 60 });
    expect(resolveWarnEscalation(4, t)?.action).toBe("kick");
    expect(resolveWarnEscalation(5, t)?.action).toBe("ban");
    expect(resolveWarnEscalation(8, t)?.action).toBe("ban");
  });
  it("aucune escalade sans paliers", () => expect(resolveWarnEscalation(3, [])).toBeNull());
});

describe("mode simulation", () => {
  it("raid : atteint le LOCKDOWN avec la configuration par défaut", () => {
    const r = runSimulation("raid", config, false, NOW);
    expect(r.threat).toBe("CRITIQUE");
    expect(r.action).toBe("LOCKDOWN automatique");
  });
  it("spam : timeout attendu", () => {
    expect(runSimulation("spam", config, false, NOW).action).toContain("exclusion");
  });
  it("nuke : mitigation configurée", () => {
    expect(runSimulation("nuke", config, false, NOW).action).toContain("Retrait des rôles");
  });
  it("phishing : détecté", () => {
    expect(runSimulation("phishing", config, false, NOW).threat).toBe("ÉLEVÉ");
  });
  it("module désactivé → aucune action", () => {
    const off = { ...config, antiRaid: { ...config.antiRaid, enabled: false } };
    expect(runSimulation("raid", off, false, NOW).action).toContain("désactivé");
  });
});

describe("transcripts", () => {
  it("échappe le HTML", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    const html = buildTranscriptHtml(
      { guildName: "G", ticketNumber: 1, category: "Support", creatorTag: "a", creatorId: "1", claimedBy: null, closedBy: "b", closeReason: "<b>ok</b>", openedAt: new Date(NOW), closedAt: new Date(NOW) },
      [{ authorTag: "x<y", authorId: "1", authorBot: false, content: "<img src=x onerror=alert(1)>", attachments: ["javascript:alert(1)", "https://cdn.discordapp.com/a.png"], embeds: 0, createdAt: new Date(NOW) }],
    );
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("a.png");
  });
});

describe("annonces", () => {
  it("valide les entrées", () => {
    expect(announcementInputSchema.safeParse({ channelId: "123456789012345678", description: "x", imageUrl: "http://insecure" }).success).toBe(false);
    expect(announcementInputSchema.safeParse({ channelId: "123456789012345678", description: "x", buttonLabel: "Go" }).success).toBe(false);
  });
  it("construit le message avec mention contrôlée", () => {
    const input = announcementInputSchema.parse({ channelId: "123456789012345678", description: "Bonjour", title: "Titre", color: "#ff0000", mention: "everyone", buttonLabel: "Site", buttonUrl: "https://example.com" });
    const msg = buildAnnouncementMessage({ embed: { ...input, color: input.color }, mention: input.mention, buttonLabel: input.buttonLabel, buttonUrl: input.buttonUrl } as never, false);
    expect(msg.content).toBe("@everyone");
    expect(msg.allowedMentions?.parse).toEqual([]);
    expect(msg.components).toHaveLength(1);
  });
});
