import type { PrismaClient } from "../database/client.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("stats");

export type StatField = "messagesDeleted" | "spamDetected" | "raidsDetected" | "linksBlocked" | "nukeDetected" | "membersVerified";

/**
 * Compteurs statistiques bufferisés en mémoire et écrits par lots (toutes les 30 s),
 * pour ne jamais faire une requête SQL par message.
 */
export class StatsService {
  private buffer = new Map<string, Partial<Record<StatField, number>>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaClient, private readonly flushIntervalMs = 30_000) {}

  start(): void {
    this.timer ??= setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref();
  }

  increment(guildId: string, field: StatField, by = 1): void {
    const entry = this.buffer.get(guildId) ?? {};
    entry[field] = (entry[field] ?? 0) + by;
    this.buffer.set(guildId, entry);
  }

  /** Valeurs en attente d'écriture (ajoutées aux valeurs en base pour un affichage à jour). */
  pending(guildId: string): Partial<Record<StatField, number>> {
    return this.buffer.get(guildId) ?? {};
  }

  async flush(): Promise<void> {
    if (this.buffer.size === 0) return;
    const batch = this.buffer;
    this.buffer = new Map();
    for (const [guildId, counters] of batch) {
      const increments = Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, { increment: v }]));
      try {
        await this.prisma.guildStatistics.upsert({
          where: { guildId },
          create: { guildId, ...counters },
          update: increments,
        });
      } catch (err) {
        log.error({ err, guildId }, "Échec d'écriture des statistiques");
      }
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
}
