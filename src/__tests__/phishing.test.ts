import { describe, expect, it } from "vitest";
import { analyzeMessage, extractDomains, extractInviteCodes, isLookalikeDomain, normalizeHost } from "../modules/security/antiPhishing/detector.js";
import { defaultGuildConfig } from "../config/guildConfig.js";

const ctx = (over: Partial<Parameters<typeof analyzeMessage>[1]> = {}) => ({
  config: defaultGuildConfig().antiPhishing,
  whitelistDomains: new Set<string>(),
  blacklistDomains: new Set<string>(),
  whitelistInvites: new Set<string>(),
  ...over,
});

describe("anti-phishing", () => {
  it("extrait et normalise les domaines", () => {
    expect(extractDomains("va sur https://WWW.Example.com/page?x=1 et google.fr")).toEqual(["example.com", "google.fr"]);
    expect(normalizeHost("https://user@sub.site.org:8080/x")).toBe("sub.site.org");
  });

  it("ne bloque pas les liens normaux", () => {
    expect(analyzeMessage("regarde https://www.youtube.com/watch?v=abc et https://github.com", ctx()).findings).toEqual([]);
    expect(analyzeMessage("doc : https://discord.js.org/docs et https://discord.com/channels/1/2", ctx()).findings).toEqual([]);
  });

  it("bloque les domaines de phishing connus et blacklistés", () => {
    expect(analyzeMessage("https://discord-nitro.gift/claim", ctx()).findings[0]?.reason).toBe("KNOWN_PHISHING");
    expect(analyzeMessage("http://evil.example.org/x", ctx({ blacklistDomains: new Set(["example.org"]) })).findings[0]?.reason).toBe("BLACKLISTED_DOMAIN");
  });

  it("la whitelist est prioritaire", () => {
    expect(analyzeMessage("https://dlscord.com/x", ctx({ whitelistDomains: new Set(["dlscord.com"]) })).findings).toEqual([]);
  });

  it("détecte les domaines imitant Discord ou Steam", () => {
    for (const host of ["disc0rd-app.com", "dlscorcl.ru", "discrod.gg", "discord-giveaway-nitro.xyz", "steamcommunlty.ru", "nitro-discordapp.site"]) {
      expect(isLookalikeDomain(host), host).toBe(true);
    }
    for (const host of ["discord.com", "discord.gift", "github.com", "disboard.org", "discord.js.org", "mydiscordbot.fr", "steampowered.com"]) {
      expect(isLookalikeDomain(host), host).toBe(false);
    }
  });

  it("détecte les arnaques au faux Nitro accompagnées d'un lien", () => {
    const r = analyzeMessage("Free Nitro for 3 months!! https://some-random-site.com/get", ctx());
    expect(r.findings.map((f) => f.reason)).toContain("SCAM_TEXT");
  });

  it("les raccourcisseurs ne sont bloqués que si configuré", () => {
    expect(analyzeMessage("https://bit.ly/abc", ctx()).findings).toEqual([]);
    const cfg = { ...defaultGuildConfig().antiPhishing, blockShorteners: true };
    expect(analyzeMessage("https://bit.ly/abc", ctx({ config: cfg })).findings[0]?.reason).toBe("SHORTENER");
  });

  it("extrait les invitations Discord et respecte la whitelist", () => {
    expect(extractInviteCodes("rejoins discord.gg/abc123 ou https://discord.com/invite/XyZ")).toEqual(["abc123", "XyZ"]);
    expect(analyzeMessage("discord.gg/abc123", ctx()).inviteCodes).toEqual(["abc123"]);
    expect(analyzeMessage("discord.gg/abc123", ctx({ whitelistInvites: new Set(["abc123"]) })).inviteCodes).toEqual([]);
    const cfg = { ...defaultGuildConfig().antiPhishing, blockInvites: false };
    expect(analyzeMessage("discord.gg/abc123", ctx({ config: cfg })).inviteCodes).toEqual([]);
  });
});
