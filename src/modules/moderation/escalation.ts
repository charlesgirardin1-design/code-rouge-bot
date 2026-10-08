import type { GuildConfig } from "../../config/guildConfig.js";

export type WarnThreshold = GuildConfig["moderation"]["warnThresholds"][number];

/**
 * Détermine la sanction automatique correspondant au nombre de warns actifs.
 * Palier exact en priorité ; au-delà du dernier palier, le palier le plus élevé s'applique.
 */
export function resolveWarnEscalation(activeWarnings: number, thresholds: readonly WarnThreshold[]): WarnThreshold | null {
  if (thresholds.length === 0 || activeWarnings <= 0) return null;
  const exact = thresholds.find((t) => t.count === activeWarnings);
  if (exact) return exact.action === "none" ? null : exact;
  const sorted = [...thresholds].sort((a, b) => a.count - b.count);
  const highest = sorted.at(-1)!;
  if (activeWarnings > highest.count && highest.action !== "none") return highest;
  return null;
}

export function warnExpiryCutoff(cfg: GuildConfig["moderation"], now = Date.now()): Date | null {
  return cfg.warnExpiryDays > 0 ? new Date(now - cfg.warnExpiryDays * 86_400_000) : null;
}
