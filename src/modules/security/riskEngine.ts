import type { GuildConfig } from "../../config/guildConfig.js";

export const SECURITY_LEVELS = ["NORMAL", "SURVEILLANCE", "REINFORCED", "LOCKDOWN"] as const;
export type SecurityLevelName = (typeof SECURITY_LEVELS)[number];

export const LEVEL_LABELS: Record<SecurityLevelName, string> = {
  NORMAL: "Niveau 1 — Normal",
  SURVEILLANCE: "Niveau 2 — Surveillance",
  REINFORCED: "Niveau 3 — Sécurité renforcée",
  LOCKDOWN: "Niveau 4 — Lockdown",
};

export const LEVEL_EMOJIS: Record<SecurityLevelName, string> = {
  NORMAL: "🟢",
  SURVEILLANCE: "🟡",
  REINFORCED: "🟠",
  LOCKDOWN: "🔴",
};

export function levelRank(level: SecurityLevelName): number {
  return SECURITY_LEVELS.indexOf(level);
}

type Thresholds = GuildConfig["riskEngine"]["thresholds"];

export function levelForScore(score: number, t: Thresholds): SecurityLevelName {
  if (score >= t.lockdown) return "LOCKDOWN";
  if (score >= t.reinforced) return "REINFORCED";
  if (score >= t.surveillance) return "SURVEILLANCE";
  return "NORMAL";
}

export function minScoreForLevel(level: SecurityLevelName, t: Thresholds): number {
  switch (level) {
    case "LOCKDOWN":
      return t.lockdown;
    case "REINFORCED":
      return t.reinforced;
    case "SURVEILLANCE":
      return t.surveillance;
    default:
      return 0;
  }
}

export interface RiskUpdate {
  score: number;
  previousLevel: SecurityLevelName;
  level: SecurityLevelName;
  changed: boolean;
}

interface GuildRiskState {
  score: number;
  updatedAt: number;
  level: SecurityLevelName;
}

/**
 * Moteur de risque par serveur : chaque événement ajoute des points,
 * le score décroît linéairement (decayPerMinute) quand la situation se calme.
 */
export class RiskEngine {
  private readonly states = new Map<string, GuildRiskState>();

  private state(guildId: string, now: number): GuildRiskState {
    let s = this.states.get(guildId);
    if (!s) {
      s = { score: 0, updatedAt: now, level: "NORMAL" };
      this.states.set(guildId, s);
    }
    return s;
  }

  private applyDecay(s: GuildRiskState, cfg: GuildConfig["riskEngine"], now: number): void {
    const minutes = Math.max(0, now - s.updatedAt) / 60_000;
    s.score = Math.max(0, s.score - cfg.decayPerMinute * minutes);
    s.updatedAt = now;
  }

  private finish(s: GuildRiskState, cfg: GuildConfig["riskEngine"]): RiskUpdate {
    const previousLevel = s.level;
    s.level = levelForScore(s.score, cfg.thresholds);
    return { score: round(s.score), previousLevel, level: s.level, changed: previousLevel !== s.level };
  }

  /** Restaure l'état persistant (au démarrage du bot). */
  restore(guildId: string, score: number, level: SecurityLevelName, now = Date.now()): void {
    this.states.set(guildId, { score, level, updatedAt: now });
  }

  add(guildId: string, points: number, cfg: GuildConfig["riskEngine"], now = Date.now()): RiskUpdate {
    const s = this.state(guildId, now);
    this.applyDecay(s, cfg, now);
    s.score = Math.max(0, s.score + points);
    return this.finish(s, cfg);
  }

  /** Force au minimum un niveau (ex. : 30 arrivées en 10 s → LOCKDOWN quel que soit le score). */
  raiseTo(guildId: string, level: SecurityLevelName, cfg: GuildConfig["riskEngine"], now = Date.now()): RiskUpdate {
    const s = this.state(guildId, now);
    this.applyDecay(s, cfg, now);
    s.score = Math.max(s.score, minScoreForLevel(level, cfg.thresholds));
    return this.finish(s, cfg);
  }

  /** Recalcule la décroissance sans ajouter de points (appelé périodiquement). */
  tick(guildId: string, cfg: GuildConfig["riskEngine"], now = Date.now()): RiskUpdate {
    const s = this.state(guildId, now);
    this.applyDecay(s, cfg, now);
    return this.finish(s, cfg);
  }

  reset(guildId: string, now = Date.now()): void {
    this.states.set(guildId, { score: 0, level: "NORMAL", updatedAt: now });
  }

  peek(guildId: string): { score: number; level: SecurityLevelName } {
    const s = this.states.get(guildId);
    return s ? { score: round(s.score), level: s.level } : { score: 0, level: "NORMAL" };
  }

  guildIds(): string[] {
    return [...this.states.keys()];
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
