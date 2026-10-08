import type { PrismaClient } from "../database/client.js";
import { applyConfigPatch, defaultGuildConfig, parseStoredConfig, type GuildConfig } from "../config/guildConfig.js";
import type { Prisma } from "../generated/prisma/client.js";

const CACHE_TTL_MS = 5 * 60_000;

export interface GuildIdentity {
  id: string;
  name: string;
  ownerId: string;
  iconHash?: string | null;
}

/**
 * Configuration par serveur avec cache mémoire : une seule lecture SQL par serveur toutes les 5 minutes
 * (ou après invalidation explicite par le dashboard via LISTEN/NOTIFY).
 */
export class GuildConfigService {
  private readonly cache = new Map<string, { config: GuildConfig; loadedAt: number }>();
  private readonly pending = new Map<string, Promise<GuildConfig>>();

  constructor(private readonly prisma: PrismaClient) {}

  async ensureGuild(guild: GuildIdentity): Promise<void> {
    await this.prisma.guild.upsert({
      where: { id: guild.id },
      create: {
        id: guild.id,
        name: guild.name,
        ownerId: guild.ownerId,
        iconHash: guild.iconHash ?? null,
        settings: { create: { config: defaultGuildConfig() as unknown as Prisma.InputJsonValue } },
        statistics: { create: {} },
      },
      update: { name: guild.name, ownerId: guild.ownerId, iconHash: guild.iconHash ?? null, leftAt: null },
    });
  }

  async get(guildId: string): Promise<GuildConfig> {
    const cached = this.cache.get(guildId);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.config;
    const inflight = this.pending.get(guildId);
    if (inflight) return inflight;
    const promise = this.load(guildId).finally(() => this.pending.delete(guildId));
    this.pending.set(guildId, promise);
    return promise;
  }

  /** Retourne la configuration en cache sans accès base (null si absente). */
  peek(guildId: string): GuildConfig | null {
    return this.cache.get(guildId)?.config ?? null;
  }

  private async load(guildId: string): Promise<GuildConfig> {
    const row = await this.prisma.guildSettings.findUnique({ where: { guildId } });
    const config = row ? parseStoredConfig(row.config) : defaultGuildConfig();
    this.cache.set(guildId, { config, loadedAt: Date.now() });
    return config;
  }

  /** Valide puis enregistre un patch partiel. Retourne les erreurs de validation le cas échéant. */
  async update(guildId: string, patch: unknown, actorId: string): Promise<{ ok: true; config: GuildConfig } | { ok: false; errors: string[] }> {
    const current = await this.get(guildId);
    const result = applyConfigPatch(current, patch);
    if (!result.success) {
      return { ok: false, errors: result.error.issues.map((i) => `${i.path.join(".") || "config"} : ${i.message}`) };
    }
    await this.save(guildId, result.data, actorId);
    return { ok: true, config: result.data };
  }

  async replace(guildId: string, config: GuildConfig, actorId: string): Promise<void> {
    await this.save(guildId, config, actorId);
  }

  private async save(guildId: string, config: GuildConfig, actorId: string): Promise<void> {
    const json = config as unknown as Prisma.InputJsonValue;
    await this.prisma.guildSettings.upsert({
      where: { guildId },
      create: { guildId, config: json, updatedBy: actorId },
      update: { config: json, updatedBy: actorId },
    });
    this.cache.set(guildId, { config, loadedAt: Date.now() });
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}
