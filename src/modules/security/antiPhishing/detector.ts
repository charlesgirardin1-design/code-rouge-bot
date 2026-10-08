import { domainToUnicode } from "node:url";
import type { GuildConfig } from "../../../config/guildConfig.js";
import { BUILTIN_PHISHING_DOMAINS } from "./knownDomains.js";

const URL_PATTERN = /\bhttps?:\/\/[^\s<>()"']+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|gg|gift|io|ru|xyz|ly|co|me|link|site|online|shop|fun|club|top|info|app|dev|tk|ml|ga|cf|gq|pw|cc|us|fr)(?:\/[^\s<>()"']*)?/gi;
const INVITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg|discord\.me|discord\.io|invite\.gg)\/([a-z0-9-]{2,32})/gi;

/** Domaines officiels de Discord : jamais considérés comme du phishing. */
export const OFFICIAL_DISCORD_DOMAINS = [
  "discord.com",
  "discord.gg",
  "discordapp.com",
  "discordapp.net",
  "discord.media",
  "discord.gift",
  "discord.new",
  "discordstatus.com",
  "dis.gd",
  "discord.dev",
  "discord.co",
];

const OFFICIAL_STEAM_DOMAINS = ["steampowered.com", "steamcommunity.com", "steamstatic.com", "steam-chat.com", "steamgames.com"];

const IMPERSONATED_BRANDS: Array<{ brand: string; official: string[] }> = [
  { brand: "discord", official: OFFICIAL_DISCORD_DOMAINS },
  { brand: "discordapp", official: OFFICIAL_DISCORD_DOMAINS },
  { brand: "steamcommunity", official: OFFICIAL_STEAM_DOMAINS },
  { brand: "steampowered", official: OFFICIAL_STEAM_DOMAINS },
];

const SCAM_TEXT = [
  /free\s*(discord\s*)?nitro/i,
  /nitro\s*(gratuit|free|gift)/i,
  /(gratuit|offert)\w*\s.{0,20}nitro/i,
  /steam\s*gift|gift\s*from\s*steam/i,
  /airdrop|claim\s+your\s+(reward|gift|prize)/i,
  /i('|’)?m\s+leaving\s+cs:?go|giving\s+away\s+my\s+(inventory|skins)/i,
];

export interface PhishingContext {
  config: GuildConfig["antiPhishing"];
  whitelistDomains: ReadonlySet<string>;
  blacklistDomains: ReadonlySet<string>;
  whitelistInvites: ReadonlySet<string>;
}

export type PhishingReason =
  | "BLACKLISTED_DOMAIN"
  | "KNOWN_PHISHING"
  | "LOOKALIKE_DOMAIN"
  | "SCAM_TEXT"
  | "SHORTENER"
  | "INVITE";

export const PHISHING_REASON_LABELS: Record<PhishingReason, string> = {
  BLACKLISTED_DOMAIN: "Domaine blacklisté",
  KNOWN_PHISHING: "Lien de phishing connu",
  LOOKALIKE_DOMAIN: "Domaine imitant un site officiel",
  SCAM_TEXT: "Arnaque (faux Nitro / faux cadeau)",
  SHORTENER: "Raccourcisseur d'URL interdit",
  INVITE: "Invitation Discord non autorisée",
};

export interface PhishingFinding {
  reason: PhishingReason;
  value: string;
}

export interface PhishingAnalysis {
  domains: string[];
  /** Codes d'invitation à vérifier (peuvent appartenir au serveur lui-même) */
  inviteCodes: string[];
  findings: PhishingFinding[];
}

export function normalizeHost(raw: string): string | null {
  let host = raw.trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0]!.split("@").pop()!.split(":")[0]!;
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return null;
  return host;
}

export function extractDomains(content: string): string[] {
  const out = new Set<string>();
  for (const match of content.matchAll(URL_PATTERN)) {
    const host = normalizeHost(match[0]);
    if (host) out.add(host);
  }
  return [...out];
}

export function extractInviteCodes(content: string): string[] {
  return [...new Set([...content.matchAll(INVITE_PATTERN)].map((m) => m[1]!))];
}

/** Le domaine (ou un de ses parents) figure-t-il dans la liste ? */
export function matchesDomain(host: string, list: Iterable<string>): boolean {
  for (const entry of list) {
    if (host === entry || host.endsWith(`.${entry}`)) return true;
  }
  return false;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Remplace les homoglyphes courants (l→i, 0→o, rn→m, cl→d…). */
function deconfuse(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/rn/g, "m")
    .replace(/cl/g, "d")
    .replace(/[1l|]/g, "i")
    .replace(/0/g, "o")
    .replace(/3/g, "e")
    .replace(/5/g, "s")
    .replace(/vv/g, "w");
}

/** Sites communautaires légitimes contenant le nom d'une marque. */
const BENIGN_DOMAINS = [
  "discord.js.org",
  "discordjs.guide",
  "discordjs.dev",
  "discordpy.readthedocs.io",
  "disboard.org",
  "discordbotlist.com",
  "discords.com",
  "discordservers.com",
  "discordlist.gg",
  "discordstatus.com",
  "top.gg",
];

const SCAM_HOST_KEYWORDS = /nitro|gift|free|airdrop|give|promo|claim|reward|bonus|drop|trade|skin/;

/**
 * Détecte un domaine qui imite une marque (Discord, Steam) sans en être un domaine officiel :
 * homoglyphes (disc0rd, dlscord), fautes volontaires (discrod) ou marque + mot-clé d'arnaque (discord-nitro.xyz).
 */
export function isLookalikeDomain(host: string): boolean {
  if (matchesDomain(host, BENIGN_DOMAINS)) return false;
  const unicodeHost = host.includes("xn--") ? domainToUnicode(host) : host;
  const labels = unicodeHost.split(".").slice(0, -1).flatMap((l) => l.split("-"));
  for (const { brand, official } of IMPERSONATED_BRANDS) {
    if (matchesDomain(host, official)) return false;
    for (const label of labels) {
      if (label === brand) continue;
      const clean = deconfuse(label);
      if (clean === brand) return true; // homoglyphes
      if (Math.abs(label.length - brand.length) <= 1 && levenshtein(label, brand) <= 2) return true; // typosquatting
    }
    const flat = deconfuse(unicodeHost.replace(/[.-]/g, ""));
    if (flat.includes(brand) && SCAM_HOST_KEYWORDS.test(flat.replace(brand, ""))) return true;
  }
  return false;
}

/**
 * Analyse le contenu d'un message. Aucun lien n'est bloqué « par défaut » :
 * seuls les liens correspondant à une règle (liste, heuristique, configuration) produisent un résultat.
 */
export function analyzeMessage(content: string, ctx: PhishingContext): PhishingAnalysis {
  const cfg = ctx.config;
  const domains = extractDomains(content);
  const inviteCodes = extractInviteCodes(content).filter((c) => !ctx.whitelistInvites.has(c.toLowerCase()));
  const findings: PhishingFinding[] = [];

  for (const host of domains) {
    if (matchesDomain(host, ctx.whitelistDomains)) continue;
    if (matchesDomain(host, ctx.blacklistDomains)) {
      findings.push({ reason: "BLACKLISTED_DOMAIN", value: host });
      continue;
    }
    if (matchesDomain(host, OFFICIAL_DISCORD_DOMAINS)) continue;
    if (cfg.useBuiltinList && matchesDomain(host, BUILTIN_PHISHING_DOMAINS)) {
      findings.push({ reason: "KNOWN_PHISHING", value: host });
      continue;
    }
    if (cfg.heuristics && isLookalikeDomain(host)) {
      findings.push({ reason: "LOOKALIKE_DOMAIN", value: host });
      continue;
    }
    if (cfg.blockShorteners && matchesDomain(host, cfg.shortenerDomains)) {
      findings.push({ reason: "SHORTENER", value: host });
    }
  }

  // Texte d'arnaque accompagné d'un lien non officiel
  const hasExternalLink = domains.some((d) => !matchesDomain(d, ctx.whitelistDomains) && !matchesDomain(d, OFFICIAL_DISCORD_DOMAINS));
  if (cfg.heuristics && hasExternalLink && SCAM_TEXT.some((re) => re.test(content))) {
    findings.push({ reason: "SCAM_TEXT", value: "contenu" });
  }

  return { domains, inviteCodes: cfg.blockInvites ? inviteCodes : [], findings };
}
