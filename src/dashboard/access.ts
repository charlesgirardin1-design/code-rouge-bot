import type { PrismaClient } from "../database/client.js";
import type { GuildConfigService } from "../services/guildConfigService.js";
import { computeGuildPermissions, computePermissionLevel, type PermissionLevel } from "../permissions/levels.js";
import { ExpiringMap } from "../utils/timeWindow.js";
import type { DiscordApi, GuildSnapshot } from "./discordApi.js";
import { HttpError } from "./errors.js";

export interface GuildAccess {
  guild: GuildSnapshot;
  level: PermissionLevel;
  permissions: bigint;
}

/**
 * Calcule les droits d'un utilisateur sur un serveur À PARTIR DE DISCORD (jeton du bot),
 * jamais à partir de données envoyées par le navigateur.
 */
export class AccessService {
  private readonly cache = new ExpiringMap<string, GuildAccess | null>(30_000);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly discord: DiscordApi,
    private readonly configs: GuildConfigService,
  ) {}

  async resolve(userId: string, guildId: string): Promise<GuildAccess | null> {
    if (!/^\d{17,20}$/.test(guildId)) return null;
    const key = `${userId}:${guildId}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const known = await this.prisma.guild.findFirst({ where: { id: guildId, leftAt: null }, select: { id: true } });
    let access: GuildAccess | null = null;
    if (known) {
      const guild = await this.discord.getGuild(guildId);
      const roles = guild ? await this.discord.getMemberRoles(guildId, userId) : null;
      if (guild && roles) {
        const config = await this.configs.get(guildId);
        const permissions = computeGuildPermissions(roles, guild.roles, guild.id);
        const level = computePermissionLevel({ userId, ownerId: guild.ownerId, permissions, roleIds: roles, config: config.permissions });
        access = { guild, level, permissions };
      }
    }
    this.cache.set(key, access);
    return access;
  }

  /** Lève 403/404 si l'utilisateur n'a pas le niveau requis sur ce serveur. */
  async require(userId: string, guildId: string, required: PermissionLevel): Promise<GuildAccess> {
    const access = await this.resolve(userId, guildId);
    if (!access) throw new HttpError(404, "Serveur introuvable ou inaccessible");
    if (access.level < required) throw new HttpError(403, "Permissions insuffisantes sur ce serveur");
    return access;
  }

  invalidate(userId: string, guildId: string): void {
    this.cache.delete(`${userId}:${guildId}`);
  }
}
