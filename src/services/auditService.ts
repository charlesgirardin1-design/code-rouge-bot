import type { ActorType, PrismaClient } from "../database/client.js";
import type { Prisma } from "../generated/prisma/client.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("audit");

export interface AuditEntry {
  guildId: string;
  actorId: string;
  actorType: ActorType;
  action: string;
  targetId?: string | null;
  targetType?: string | null;
  reason?: string | null;
  success?: boolean;
  details?: Record<string, unknown>;
}

/** Traçabilité : QUI, QUOI, QUAND, SUR QUI, POURQUOI, QUEL RÉSULTAT. */
export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          guildId: entry.guildId,
          actorId: entry.actorId,
          actorType: entry.actorType,
          action: entry.action,
          targetId: entry.targetId ?? null,
          targetType: entry.targetType ?? null,
          reason: entry.reason ?? null,
          success: entry.success ?? true,
          details: (entry.details ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      // L'audit ne doit jamais faire échouer l'action elle-même.
      log.error({ err, action: entry.action, guildId: entry.guildId }, "Échec d'écriture du journal d'audit");
    }
  }
}
