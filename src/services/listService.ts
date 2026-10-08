import type { PrismaClient, ListType } from "../database/client.js";

export interface GuildLists {
  whitelistDomains: Set<string>;
  blacklistDomains: Set<string>;
  whitelistInvites: Set<string>;
}

const TTL_MS = 5 * 60_000;

/** Listes blanches / noires (domaines, invitations) par serveur, mises en cache. */
export class ListService {
  private readonly cache = new Map<string, { lists: GuildLists; loadedAt: number }>();

  constructor(private readonly prisma: PrismaClient) {}

  async get(guildId: string): Promise<GuildLists> {
    const cached = this.cache.get(guildId);
    if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached.lists;
    const [white, black] = await Promise.all([
      this.prisma.whitelist.findMany({ where: { guildId } }),
      this.prisma.blacklist.findMany({ where: { guildId } }),
    ]);
    const lists: GuildLists = {
      whitelistDomains: new Set(white.filter((w) => w.type === "DOMAIN").map((w) => w.value)),
      whitelistInvites: new Set(white.filter((w) => w.type === "INVITE").map((w) => w.value)),
      blacklistDomains: new Set(black.filter((b) => b.type === "DOMAIN").map((b) => b.value)),
    };
    this.cache.set(guildId, { lists, loadedAt: Date.now() });
    return lists;
  }

  async add(kind: "whitelist" | "blacklist", guildId: string, type: ListType, value: string, addedBy: string, reason?: string | null) {
    const data = { guildId, type, value, addedBy, reason: reason ?? null };
    const where = { guildId_type_value: { guildId, type, value } };
    const row =
      kind === "whitelist"
        ? await this.prisma.whitelist.upsert({ where, create: data, update: { reason: data.reason, addedBy } })
        : await this.prisma.blacklist.upsert({ where, create: data, update: { reason: data.reason, addedBy } });
    // Un domaine ne peut pas être à la fois dans les deux listes.
    if (kind === "whitelist") await this.prisma.blacklist.deleteMany({ where: { guildId, type, value } });
    else await this.prisma.whitelist.deleteMany({ where: { guildId, type, value } });
    this.invalidate(guildId);
    return row;
  }

  async remove(kind: "whitelist" | "blacklist", guildId: string, type: ListType, value: string): Promise<boolean> {
    const res =
      kind === "whitelist"
        ? await this.prisma.whitelist.deleteMany({ where: { guildId, type, value } })
        : await this.prisma.blacklist.deleteMany({ where: { guildId, type, value } });
    this.invalidate(guildId);
    return res.count > 0;
  }

  async list(kind: "whitelist" | "blacklist", guildId: string, type: ListType) {
    return kind === "whitelist"
      ? this.prisma.whitelist.findMany({ where: { guildId, type }, orderBy: { createdAt: "desc" } })
      : this.prisma.blacklist.findMany({ where: { guildId, type }, orderBy: { createdAt: "desc" } });
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}
