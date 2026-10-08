import type { GuildConfig } from "../../../config/guildConfig.js";
import { nameSkeleton } from "../../../utils/text.js";
import { ExpiringMap, pruneOlderThan } from "../../../utils/timeWindow.js";
import type { SecurityLevelName } from "../riskEngine.js";

export interface JoinInput {
  guildId: string;
  userId: string;
  username: string;
  accountCreatedAt: number;
  hasAvatar: boolean;
  timestamp: number;
}

export interface JoinAnalysis {
  /** Arrivées dans la fenêtre (incluant celle-ci) */
  joinCount: number;
  /** Niveau minimum imposé par le volume d'arrivées */
  suggestedLevel: SecurityLevelName;
  isNewAccount: boolean;
  /** Nombre de comptes au pseudo similaire dans la fenêtre (incluant celui-ci) */
  similarCount: number;
  /** Proportion de comptes récents dans la fenêtre */
  newAccountRatio: number;
  wave: boolean;
  riskPoints: number;
  reasons: string[];
}

interface JoinRecord {
  ts: number;
  userId: string;
  skeleton: string;
  newAccount: boolean;
}

const DAY_MS = 86_400_000;

/** Détection des raids par fenêtre glissante des arrivées, en mémoire. */
export class RaidDetector {
  private readonly joins = new ExpiringMap<string, JoinRecord[]>(30 * 60_000);
  private readonly recentJoinTimes = new ExpiringMap<string, number>(10 * 60_000);

  recordJoin(input: JoinInput, cfg: GuildConfig["antiRaid"], points: GuildConfig["riskEngine"]["points"]): JoinAnalysis {
    const now = input.timestamp;
    const list = this.joins.getOrCreate(input.guildId, () => [], now);
    pruneOlderThan(list, cfg.windowSeconds * 1000, now);

    const isNewAccount = now - input.accountCreatedAt < cfg.newAccountDays * DAY_MS;
    const skeleton = nameSkeleton(input.username);
    list.push({ ts: now, userId: input.userId, skeleton, newAccount: isNewAccount });
    this.recentJoinTimes.set(`${input.guildId}:${input.userId}`, now, now);

    const joinCount = list.length;
    const similarCount = skeleton.length >= 4 ? list.filter((j) => j.skeleton.length >= 4 && shareStem(j.skeleton, skeleton)).length : 1;
    const newAccountRatio = list.filter((j) => j.newAccount).length / joinCount;

    let suggestedLevel: SecurityLevelName = "NORMAL";
    if (joinCount >= cfg.lockdownJoins) suggestedLevel = "LOCKDOWN";
    else if (joinCount >= cfg.reinforcedJoins) suggestedLevel = "REINFORCED";
    else if (joinCount >= cfg.surveillanceJoins) suggestedLevel = "SURVEILLANCE";

    const reasons: string[] = [];
    let riskPoints = 0;
    if (joinCount >= cfg.surveillanceJoins) {
      riskPoints += points.fastJoin;
      reasons.push(`${joinCount} arrivées en ${cfg.windowSeconds}s`);
    }
    if (isNewAccount) {
      riskPoints += points.newAccount;
      reasons.push(`compte créé il y a moins de ${cfg.newAccountDays} jour(s)`);
    }
    const similarWave = similarCount >= cfg.similarNameThreshold;
    const newAccountWave = joinCount >= cfg.surveillanceJoins && newAccountRatio >= 0.6;
    const wave = similarWave || newAccountWave || joinCount >= cfg.reinforcedJoins;
    if (wave) {
      riskPoints += points.joinWave;
      if (similarWave) reasons.push(`${similarCount} comptes au pseudo similaire`);
      if (newAccountWave) reasons.push(`${Math.round(newAccountRatio * 100)}% de comptes récents dans la vague`);
    }
    // Un compte récent isolé, hors vague, n'est pas suspect en soi : pas de points de raid.
    if (!wave && joinCount < cfg.surveillanceJoins) riskPoints = 0;

    return { joinCount, suggestedLevel, isNewAccount, similarCount, newAccountRatio, wave, riskPoints, reasons };
  }

  /** Retourne le délai (ms) depuis l'arrivée si le membre est arrivé récemment, sinon null. */
  timeSinceJoin(guildId: string, userId: string, now = Date.now()): number | null {
    const ts = this.recentJoinTimes.get(`${guildId}:${userId}`, now);
    return ts === undefined ? null : now - ts;
  }

  currentJoinCount(guildId: string, windowSeconds: number, now = Date.now()): number {
    const list = this.joins.get(guildId, now);
    return list ? list.filter((j) => now - j.ts <= windowSeconds * 1000).length : 0;
  }

  sweep(now = Date.now()): void {
    this.joins.sweep(now);
    this.recentJoinTimes.sweep(now);
  }
}

/** Deux squelettes de pseudo partagent une racine commune significative. */
function shareStem(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  if (len < 4) return false;
  let common = 0;
  while (common < len && a[common] === b[common]) common++;
  return common >= Math.max(4, Math.ceil(len * 0.75));
}
