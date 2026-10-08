import { DiscordPerm } from "../../../permissions/levels.js";
import { ExpiringMap, pruneOlderThan } from "../../../utils/timeWindow.js";
import type { GuildConfig } from "../../../config/guildConfig.js";

const DANGEROUS: Array<[bigint, string]> = [
  [DiscordPerm.Administrator, "Administrateur"],
  [DiscordPerm.ManageGuild, "Gérer le serveur"],
  [DiscordPerm.ManageRoles, "Gérer les rôles"],
  [DiscordPerm.ManageChannels, "Gérer les salons"],
  [DiscordPerm.BanMembers, "Bannir des membres"],
  [DiscordPerm.KickMembers, "Expulser des membres"],
  [DiscordPerm.ManageWebhooks, "Gérer les webhooks"],
];

export function listDangerousPermissions(permissions: bigint): string[] {
  return DANGEROUS.filter(([bit]) => (permissions & bit) !== 0n).map(([, label]) => label);
}

export interface BotAdditionAnalysis {
  dangerousPermissions: string[];
  isAdministrator: boolean;
  botsAddedInWindow: number;
  tooManyBots: boolean;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export class BotAdditionTracker {
  private readonly additions = new ExpiringMap<string, { ts: number }[]>(24 * 3_600_000);

  analyze(guildId: string, permissions: bigint, cfg: GuildConfig["antiBot"], now = Date.now()): BotAdditionAnalysis {
    const list = this.additions.getOrCreate(guildId, () => [], now);
    pruneOlderThan(list, cfg.windowMinutes * 60_000, now);
    list.push({ ts: now });

    const dangerousPermissions = listDangerousPermissions(permissions);
    const isAdministrator = (permissions & DiscordPerm.Administrator) !== 0n;
    const tooManyBots = list.length > cfg.maxBotsInWindow;
    const severity = isAdministrator || (tooManyBots && dangerousPermissions.length > 0)
      ? "CRITICAL"
      : dangerousPermissions.length >= 2 || tooManyBots
        ? "HIGH"
        : dangerousPermissions.length === 1
          ? "MEDIUM"
          : "LOW";
    return { dangerousPermissions, isAdministrator, botsAddedInWindow: list.length, tooManyBots, severity };
  }

  sweep(now = Date.now()): void {
    this.additions.sweep(now);
  }
}
