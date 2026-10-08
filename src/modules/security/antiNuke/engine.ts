import type { GuildConfig } from "../../../config/guildConfig.js";
import { ExpiringMap, pruneOlderThan } from "../../../utils/timeWindow.js";

export type NukeAction = keyof GuildConfig["antiNuke"]["thresholds"];

export const NUKE_ACTION_LABELS: Record<NukeAction, string> = {
  channelDelete: "Suppressions de salons",
  channelCreate: "Créations de salons",
  roleDelete: "Suppressions de rôles",
  roleCreate: "Créations de rôles",
  ban: "Bannissements",
  kick: "Expulsions",
  permissionUpdate: "Modifications de permissions",
  webhookCreate: "Créations de webhooks",
  guildUpdate: "Modifications du serveur",
};

export interface NukeRecord {
  action: NukeAction;
  executorId: string;
  targetId: string | null;
  targetName: string | null;
  details?: Record<string, unknown>;
}

export interface NukeVerdict {
  count: number;
  threshold: number;
  triggered: boolean;
  /** Toutes les actions de ce type par cet exécutant dans la fenêtre (pour les logs) */
  recent: NukeRecord[];
}

interface Entry {
  ts: number;
  record: NukeRecord;
}

/**
 * Compte les actions administratives par exécutant dans une fenêtre glissante.
 * Ne déclenche qu'une fois par fenêtre et par (exécutant, type d'action).
 */
export class NukeTracker {
  private readonly entries = new ExpiringMap<string, Entry[]>(15 * 60_000);
  private readonly lastTrigger = new ExpiringMap<string, number>(15 * 60_000);

  record(guildId: string, rec: NukeRecord, cfg: GuildConfig["antiNuke"], now = Date.now()): NukeVerdict {
    const key = `${guildId}:${rec.executorId}:${rec.action}`;
    const windowMs = cfg.windowSeconds * 1000;
    const list = this.entries.getOrCreate(key, () => [], now);
    pruneOlderThan(list, windowMs, now);
    list.push({ ts: now, record: rec });

    const threshold = cfg.thresholds[rec.action];
    const last = this.lastTrigger.get(key, now);
    const triggered = list.length >= threshold && (last === undefined || now - last > windowMs);
    if (triggered) this.lastTrigger.set(key, now, now);
    return { count: list.length, threshold, triggered, recent: list.map((e) => e.record) };
  }

  sweep(now = Date.now()): void {
    this.entries.sweep(now);
    this.lastTrigger.sweep(now);
  }
}
