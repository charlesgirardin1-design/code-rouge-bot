import type { GuildConfig } from "../../config/guildConfig.js";
import type { SecurityEventType, Severity } from "../../database/client.js";
import { RiskEngine, LEVEL_LABELS, type SecurityLevelName } from "./riskEngine.js";
import { RaidDetector } from "./antiRaid/engine.js";
import { AntiSpamEngine, VIOLATION_LABELS } from "./antiSpam/engine.js";
import { NukeTracker } from "./antiNuke/engine.js";
import { computeAltRisk } from "./antiAlt/score.js";
import { analyzeMessage, PHISHING_REASON_LABELS } from "./antiPhishing/detector.js";

export const SIMULATION_KINDS = ["raid", "spam", "nuke", "phishing", "alt"] as const;
export type SimulationKind = (typeof SIMULATION_KINDS)[number];

export interface SimulationResult {
  kind: SimulationKind;
  eventType: SecurityEventType;
  eventLabel: string;
  threat: "FAIBLE" | "MOYEN" | "ÉLEVÉ" | "CRITIQUE";
  severity: Severity;
  action: string;
  details: string[];
  enabled: boolean;
}

/**
 * Rejoue un scénario synthétique dans des instances isolées des vrais moteurs de détection,
 * avec la configuration du serveur. Aucune action Discord n'est effectuée.
 */
export function runSimulation(kind: SimulationKind, config: GuildConfig, lockdownActive: boolean, now = Date.now()): SimulationResult {
  switch (kind) {
    case "raid":
      return simulateRaid(config, lockdownActive, now);
    case "spam":
      return simulateSpam(config, now);
    case "nuke":
      return simulateNuke(config, now);
    case "phishing":
      return simulatePhishing(config);
    case "alt":
      return simulateAlt(config, now);
  }
}

function threatFromLevel(level: SecurityLevelName): SimulationResult["threat"] {
  return level === "LOCKDOWN" ? "CRITIQUE" : level === "REINFORCED" ? "ÉLEVÉ" : level === "SURVEILLANCE" ? "MOYEN" : "FAIBLE";
}

function simulateRaid(config: GuildConfig, lockdownActive: boolean, now: number): SimulationResult {
  const raid = new RaidDetector();
  const risk = new RiskEngine();
  const total = config.antiRaid.lockdownJoins;
  const step = Math.floor((config.antiRaid.windowSeconds * 1000 * 0.8) / total);
  let level: SecurityLevelName = "NORMAL";
  let firstSurveillance: number | null = null;
  for (let i = 0; i < total; i++) {
    const ts = now + i * step;
    const a = raid.recordJoin(
      { guildId: "sim", userId: `sim${i}`, username: `raider${1000 + i}`, accountCreatedAt: ts - 3_600_000, hasAvatar: false, timestamp: ts },
      config.antiRaid,
      config.riskEngine.points,
    );
    let u = risk.add("sim", a.riskPoints, config.riskEngine, ts);
    if (a.suggestedLevel !== "NORMAL") u = risk.raiseTo("sim", a.suggestedLevel, config.riskEngine, ts);
    level = u.level;
    if (firstSurveillance === null && u.level !== "NORMAL") firstSurveillance = i + 1;
  }
  const action =
    level === "LOCKDOWN"
      ? config.riskEngine.autoLockdown
        ? lockdownActive
          ? "LOCKDOWN (déjà actif) — quarantaine des nouvelles arrivées"
          : "LOCKDOWN automatique"
        : "Alerte LOCKDOWN (lockdown automatique désactivé)"
      : `Passage au ${LEVEL_LABELS[level]}`;
  return {
    kind: "raid",
    eventType: "RAID",
    eventLabel: "RAID",
    threat: threatFromLevel(level),
    severity: level === "LOCKDOWN" ? "CRITICAL" : "HIGH",
    action: config.antiRaid.enabled ? action : "Aucune (anti-raid désactivé)",
    enabled: config.antiRaid.enabled,
    details: [
      `${total} comptes récents sans avatar arrivés en ${((total * step) / 1000).toFixed(1)} s`,
      `Surveillance déclenchée dès la ${firstSurveillance ?? "—"}e arrivée`,
      `Niveau final : ${LEVEL_LABELS[level]} (score ${risk.peek("sim").score})`,
    ],
  };
}

function simulateSpam(config: GuildConfig, now: number): SimulationResult {
  const engine = new AntiSpamEngine();
  const cfg = config.antiSpam;
  const step = Math.floor((cfg.windowSeconds * 1000 * 0.8) / cfg.timeoutMessages);
  const timeline: string[] = [];
  let last = "none";
  let worst = "none" as "none" | "warn" | "timeout" | "severe_timeout";
  const rank = { none: 0, warn: 1, timeout: 2, severe_timeout: 3 } as const;
  for (let i = 0; i < cfg.timeoutMessages; i++) {
    const v = engine.evaluate(
      { guildId: "sim", userId: "sim", channelId: "c", messageId: `m${i}`, content: "ACHETEZ MAINTENANT !!! promo exclusive", mentionCount: 0, linkCount: 0, timestamp: now + i * step },
      cfg,
    );
    if (rank[v.action] > rank[worst]) worst = v.action;
    if (v.action !== last && v.action !== "none") {
      timeline.push(`Message ${i + 1} : ${v.action === "warn" ? "avertissement" : `exclusion ${v.timeoutMinutes} min`}${v.violations.length ? ` (${[...new Set(v.violations)].map((x) => VIOLATION_LABELS[x]).join(", ")})` : ""}`);
      last = v.action;
    }
  }
  const sanctioned = worst === "timeout" || worst === "severe_timeout";
  return {
    kind: "spam",
    eventType: "SPAM",
    eventLabel: "SPAM",
    threat: sanctioned ? "MOYEN" : "FAIBLE",
    severity: "MEDIUM",
    action: cfg.enabled ? (sanctioned ? `Suppression des messages + exclusion ${cfg.timeoutMinutes} min` : "Avertissement") : "Aucune (anti-spam désactivé)",
    enabled: cfg.enabled,
    details: [`${cfg.timeoutMessages} messages identiques en ${((cfg.timeoutMessages * step) / 1000).toFixed(1)} s`, ...timeline],
  };
}

function simulateNuke(config: GuildConfig, now: number): SimulationResult {
  const tracker = new NukeTracker();
  const cfg = config.antiNuke;
  const threshold = cfg.thresholds.channelDelete;
  let triggeredAt: number | null = null;
  for (let i = 0; i < threshold + 2; i++) {
    const v = tracker.record("sim", { action: "channelDelete", executorId: "sim", targetId: `${i}`, targetName: `salon-${i}` }, cfg, now + i * 500);
    if (v.triggered && triggeredAt === null) triggeredAt = i + 1;
  }
  const mitigation = { alert: "Alerte aux administrateurs", strip_roles: "Retrait des rôles dangereux de l'auteur + alerte", ban: "Bannissement de l'auteur + alerte" }[cfg.mitigation];
  return {
    kind: "nuke",
    eventType: "NUKE",
    eventLabel: "ANTI-NUKE",
    threat: "CRITIQUE",
    severity: "CRITICAL",
    action: cfg.enabled ? mitigation : "Aucune (anti-nuke désactivé)",
    enabled: cfg.enabled,
    details: [
      `${threshold + 2} salons supprimés en ${((threshold + 1) * 0.5).toFixed(1)} s par le même compte`,
      `Comportement critique détecté à la ${triggeredAt ?? "—"}e suppression (seuil : ${threshold} en ${cfg.windowSeconds} s)`,
      `+${config.riskEngine.points.nuke} points au score de menace`,
    ],
  };
}

function simulatePhishing(config: GuildConfig): SimulationResult {
  const sample = "🎁 Free Discord Nitro for everyone! Claim here: https://dlscord-nitro.gift/claim";
  const analysis = analyzeMessage(sample, { config: config.antiPhishing, whitelistDomains: new Set(), blacklistDomains: new Set(), whitelistInvites: new Set() });
  const action = { delete: "Suppression du message", delete_warn: "Suppression + avertissement", delete_timeout: `Suppression + exclusion ${config.antiPhishing.timeoutMinutes} min` }[config.antiPhishing.action];
  return {
    kind: "phishing",
    eventType: "PHISHING",
    eventLabel: "PHISHING",
    threat: analysis.findings.length ? "ÉLEVÉ" : "FAIBLE",
    severity: "HIGH",
    action: config.antiPhishing.enabled ? (analysis.findings.length ? action : "Aucune (non détecté avec la configuration actuelle)") : "Aucune (anti-phishing désactivé)",
    enabled: config.antiPhishing.enabled,
    details: [`Message testé : « ${sample} »`, ...analysis.findings.map((f) => `${PHISHING_REASON_LABELS[f.reason]} : ${f.value}`)],
  };
}

function simulateAlt(config: GuildConfig, now: number): SimulationResult {
  const r = computeAltRisk(
    { accountCreatedAt: now - 20 * 60_000, hasAvatar: false, username: "user48213", duringRaid: true, similarToRecent: false, immediateActivity: false, now },
    config.antiAlt,
  );
  const action =
    r.level === "HIGH"
      ? config.antiAlt.restrictHigh
        ? "Accès limité (rôle non vérifié) + alerte"
        : "Alerte uniquement"
      : r.level === "MEDIUM"
        ? config.antiAlt.restrictMedium
          ? "Vérification requise"
          : "Alerte uniquement"
        : "Accès normal";
  return {
    kind: "alt",
    eventType: "ALT",
    eventLabel: "COMPTE SUSPECT",
    threat: r.level === "HIGH" ? "ÉLEVÉ" : r.level === "MEDIUM" ? "MOYEN" : "FAIBLE",
    severity: r.level === "HIGH" ? "HIGH" : "MEDIUM",
    action: config.antiAlt.enabled ? action : "Aucune (anti-alt désactivé)",
    enabled: config.antiAlt.enabled,
    details: [`Compte créé il y a 20 min, sans avatar, arrivé pendant une vague`, `Score : ${r.score}/100 (${r.level})`, ...r.reasons.map((x) => `• ${x}`)],
  };
}
