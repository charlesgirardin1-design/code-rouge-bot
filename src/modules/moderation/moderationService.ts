import type { Client, Guild, GuildMember, User } from "discord.js";
import type { ModerationActionType, PrismaClient } from "../../database/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { GuildConfigService } from "../../services/guildConfigService.js";
import type { AuditService } from "../../services/auditService.js";
import { auditEmbed, type LogService } from "../logs/logService.js";
import { Colors, warningEmbed } from "../../bot/ui/embeds.js";
import { attempt, describeError, UserError } from "../../bot/errors.js";
import { formatDuration, MAX_TIMEOUT_MS } from "../../utils/duration.js";
import { childLogger } from "../../utils/logger.js";
import { resolveWarnEscalation, warnExpiryCutoff } from "./escalation.js";

const log = childLogger("moderation");

export interface Actor {
  id: string;
  tag: string;
  /** Sanction appliquée automatiquement par le bot (anti-spam, escalade des warns…) */
  automatic?: boolean;
}

export interface SanctionResult {
  caseNumber: number;
  success: boolean;
  dmSent: boolean;
  error?: string;
}

const ACTION_LABELS: Record<ModerationActionType, string> = {
  BAN: "🔨 Bannissement",
  UNBAN: "🔓 Débannissement",
  KICK: "👢 Expulsion",
  TIMEOUT: "⏳ Exclusion temporaire",
  UNTIMEOUT: "✅ Fin d'exclusion",
  WARN: "⚠️ Avertissement",
  CLEAR_WARNINGS: "🧹 Suppression d'avertissements",
  CLEAR_MESSAGES: "🧽 Suppression de messages",
  SLOWMODE: "🐢 Mode lent",
};

const ACTION_COLORS: Partial<Record<ModerationActionType, number>> = {
  BAN: Colors.error,
  KICK: Colors.error,
  TIMEOUT: Colors.warning,
  WARN: Colors.warning,
  UNBAN: Colors.success,
  UNTIMEOUT: Colors.success,
};

interface ExecuteParams {
  guild: Guild;
  type: ModerationActionType;
  actor: Actor;
  target: { id: string; tag: string | null };
  reason: string | null;
  durationMs?: number | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
  dm?: { user: User; text: string } | null;
  run: () => Promise<unknown>;
}

export class ModerationService {
  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaClient,
    private readonly configs: GuildConfigService,
    private readonly logs: LogService,
    private readonly audit: AuditService,
  ) {}

  async nextCaseNumber(guildId: string): Promise<number> {
    const guild = await this.prisma.guild.update({ where: { id: guildId }, data: { caseCounter: { increment: 1 } }, select: { caseCounter: true } });
    return guild.caseCounter;
  }

  async ensureUser(user: User): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: user.id },
      create: { id: user.id, username: user.username, globalName: user.globalName, avatarHash: user.avatar, bot: user.bot, accountCreatedAt: user.createdAt },
      update: { username: user.username, globalName: user.globalName, avatarHash: user.avatar },
    });
  }

  /**
   * Exécute une sanction et garantit sa traçabilité : MP (optionnel), action Discord,
   * enregistrement en base (succès ou échec), log modération et journal d'audit.
   */
  private async execute(p: ExecuteParams): Promise<SanctionResult> {
    const config = await this.configs.get(p.guild.id);
    let dmSent = false;
    const sendDm = async () => {
      if (!p.dm || !config.moderation.dmOnSanction) return;
      const embed = warningEmbed(`${ACTION_LABELS[p.type]} — ${p.guild.name}`, p.dm.text).setFooter({ text: p.guild.name });
      dmSent = (await attempt(p.dm.user.send({ embeds: [embed] }))) !== null;
    };
    // Après un ban ou un kick, le bot ne partage plus de serveur avec l'utilisateur : MP envoyé avant.
    const dmFirst = p.type === "BAN" || p.type === "KICK";
    if (dmFirst) await sendDm();

    let error: unknown = null;
    try {
      await p.run();
    } catch (err) {
      error = err;
    }
    if (!dmFirst && !error) await sendDm();

    const caseNumber = await this.nextCaseNumber(p.guild.id);
    const errorMessage = error ? describeError(error).message : null;
    await this.prisma.moderationAction.create({
      data: {
        guildId: p.guild.id,
        caseNumber,
        type: p.type,
        targetId: p.target.id,
        targetTag: p.target.tag,
        moderatorId: p.actor.id,
        moderatorTag: p.actor.tag,
        reason: p.reason,
        durationMs: p.durationMs ?? null,
        expiresAt: p.expiresAt ?? null,
        automatic: p.actor.automatic ?? false,
        success: !error,
        error: errorMessage,
        metadata: (p.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const extra = [{ name: "Cas", value: `#${caseNumber}`, inline: true }];
    if (p.durationMs) extra.push({ name: "Durée", value: formatDuration(p.durationMs), inline: true });
    if (p.actor.automatic) extra.push({ name: "Type", value: "Sanction automatique", inline: true });
    for (const [k, v] of Object.entries(p.metadata ?? {})) if (v !== undefined && v !== null) extra.push({ name: k, value: String(v), inline: true });

    await this.logs.send(p.guild, "moderation", {
      embeds: [
        auditEmbed({
          action: ACTION_LABELS[p.type],
          actor: `<@${p.actor.id}> (${p.actor.tag})`,
          target: `<@${p.target.id}> (${p.target.tag ?? "inconnu"} · \`${p.target.id}\`)`,
          reason: p.reason,
          result: error ? `Échec : ${errorMessage}` : "Succès",
          color: error ? Colors.error : ACTION_COLORS[p.type],
          extra,
        }),
      ],
    });
    await this.audit.record({
      guildId: p.guild.id,
      actorId: p.actor.id,
      actorType: p.actor.automatic ? "BOT" : "USER",
      action: `moderation.${p.type.toLowerCase()}`,
      targetId: p.target.id,
      targetType: "user",
      reason: p.reason,
      success: !error,
      details: { caseNumber, durationMs: p.durationMs ?? null, error: errorMessage, ...(p.metadata ?? {}) },
    });

    if (error) throw error;
    return { caseNumber, success: true, dmSent };
  }

  async ban(params: { guild: Guild; actor: Actor; user: User; reason: string | null; deleteMessageSeconds?: number; durationMs?: number | null }): Promise<SanctionResult> {
    const { guild, user } = params;
    const expiresAt = params.durationMs ? new Date(Date.now() + params.durationMs) : null;
    const auditReason = `${params.actor.tag} : ${params.reason ?? "Aucune raison"}`.slice(0, 512);
    return this.execute({
      guild,
      type: "BAN",
      actor: params.actor,
      target: { id: user.id, tag: user.tag },
      reason: params.reason,
      durationMs: params.durationMs ?? null,
      expiresAt,
      metadata: params.deleteMessageSeconds ? { "Messages supprimés": formatDuration(params.deleteMessageSeconds * 1000) } : undefined,
      dm: { user, text: `Vous avez été banni${expiresAt ? ` pour ${formatDuration(params.durationMs!)}` : ""}.\n**Raison :** ${params.reason ?? "Aucune raison fournie"}` },
      run: () => guild.members.ban(user.id, { reason: auditReason, deleteMessageSeconds: params.deleteMessageSeconds ?? 0 }),
    });
  }

  async unban(params: { guild: Guild; actor: Actor; userId: string; reason: string | null }): Promise<SanctionResult> {
    const { guild } = params;
    const ban = await guild.bans.fetch(params.userId).catch(() => null);
    if (!ban) throw new UserError("Cet utilisateur n'est pas banni de ce serveur.");
    const result = await this.execute({
      guild,
      type: "UNBAN",
      actor: params.actor,
      target: { id: params.userId, tag: ban.user.tag },
      reason: params.reason,
      run: () => guild.members.unban(params.userId, `${params.actor.tag} : ${params.reason ?? "Aucune raison"}`.slice(0, 512)),
    });
    await this.prisma.moderationAction.updateMany({ where: { guildId: guild.id, targetId: params.userId, type: "BAN", expired: false }, data: { expired: true } });
    return result;
  }

  async kick(params: { guild: Guild; actor: Actor; member: GuildMember; reason: string | null }): Promise<SanctionResult> {
    const { guild, member } = params;
    return this.execute({
      guild,
      type: "KICK",
      actor: params.actor,
      target: { id: member.id, tag: member.user.tag },
      reason: params.reason,
      dm: { user: member.user, text: `Vous avez été expulsé.\n**Raison :** ${params.reason ?? "Aucune raison fournie"}` },
      run: () => member.kick(`${params.actor.tag} : ${params.reason ?? "Aucune raison"}`.slice(0, 512)),
    });
  }

  async timeout(params: { guild: Guild; actor: Actor; member: GuildMember; durationMs: number; reason: string | null }): Promise<SanctionResult> {
    const { guild, member } = params;
    if (params.durationMs > MAX_TIMEOUT_MS) throw new UserError("La durée maximale d'une exclusion temporaire est de 28 jours.");
    if (!member.moderatable) throw new UserError("Je ne peux pas exclure ce membre (rôle trop élevé ou administrateur).");
    return this.execute({
      guild,
      type: "TIMEOUT",
      actor: params.actor,
      target: { id: member.id, tag: member.user.tag },
      reason: params.reason,
      durationMs: params.durationMs,
      expiresAt: new Date(Date.now() + params.durationMs),
      dm: { user: member.user, text: `Vous avez été exclu temporairement pour **${formatDuration(params.durationMs)}**.\n**Raison :** ${params.reason ?? "Aucune raison fournie"}` },
      run: () => member.timeout(params.durationMs, `${params.actor.tag} : ${params.reason ?? "Aucune raison"}`.slice(0, 512)),
    });
  }

  async untimeout(params: { guild: Guild; actor: Actor; member: GuildMember; reason: string | null }): Promise<SanctionResult> {
    const { guild, member } = params;
    if (!member.isCommunicationDisabled()) throw new UserError("Ce membre n'est pas exclu temporairement.");
    return this.execute({
      guild,
      type: "UNTIMEOUT",
      actor: params.actor,
      target: { id: member.id, tag: member.user.tag },
      reason: params.reason,
      run: () => member.timeout(null, `${params.actor.tag} : ${params.reason ?? "Aucune raison"}`.slice(0, 512)),
    });
  }

  async countActiveWarnings(guildId: string, userId: string): Promise<number> {
    const config = await this.configs.get(guildId);
    const cutoff = warnExpiryCutoff(config.moderation);
    return this.prisma.warning.count({ where: { guildId, userId, active: true, ...(cutoff ? { createdAt: { gte: cutoff } } : {}) } });
  }

  async warn(params: { guild: Guild; actor: Actor; member: GuildMember; reason: string }): Promise<{ result: SanctionResult; warningId: number; activeCount: number; escalation: string | null }> {
    const { guild, member } = params;
    await this.ensureUser(member.user);
    let warningId = 0;
    const result = await this.execute({
      guild,
      type: "WARN",
      actor: params.actor,
      target: { id: member.id, tag: member.user.tag },
      reason: params.reason,
      dm: { user: member.user, text: `Vous avez reçu un avertissement.\n**Raison :** ${params.reason}` },
      run: async () => {
        const w = await this.prisma.warning.create({ data: { guildId: guild.id, userId: member.id, moderatorId: params.actor.id, reason: params.reason } });
        warningId = w.id;
      },
    });
    const activeCount = await this.countActiveWarnings(guild.id, member.id);
    const escalation = await this.applyWarnEscalation(guild, member, activeCount);
    return { result, warningId, activeCount, escalation };
  }

  /** Sanction automatique selon les paliers configurés. Retourne une description de la sanction appliquée. */
  private async applyWarnEscalation(guild: Guild, member: GuildMember, activeCount: number): Promise<string | null> {
    const config = await this.configs.get(guild.id);
    const rule = resolveWarnEscalation(activeCount, config.moderation.warnThresholds);
    if (!rule) return null;
    const me = guild.members.me;
    if (!me || member.id === guild.ownerId || member.roles.highest.position >= me.roles.highest.position) {
      log.warn({ guildId: guild.id, userId: member.id }, "Escalade de warn impossible : hiérarchie");
      return `${rule.action} impossible (hiérarchie des rôles)`;
    }
    const actor: Actor = { id: this.client.user!.id, tag: this.client.user!.tag, automatic: true };
    const reason = `Sanction automatique : ${activeCount} avertissement(s) actif(s)`;
    try {
      switch (rule.action) {
        case "timeout": {
          const ms = (rule.durationMinutes ?? 10) * 60_000;
          await this.timeout({ guild, actor, member, durationMs: ms, reason });
          return `Exclusion temporaire de ${formatDuration(ms)}`;
        }
        case "kick":
          await this.kick({ guild, actor, member, reason });
          return "Expulsion";
        case "ban":
          await this.ban({ guild, actor, user: member.user, reason });
          return "Bannissement";
        default:
          return null;
      }
    } catch (err) {
      return `Échec de la sanction automatique : ${describeError(err).message}`;
    }
  }

  async clearWarnings(params: { guild: Guild; actor: Actor; userId: string; userTag: string | null; warningId?: number | null; reason: string | null }): Promise<number> {
    const { guild } = params;
    let cleared = 0;
    await this.execute({
      guild,
      type: "CLEAR_WARNINGS",
      actor: params.actor,
      target: { id: params.userId, tag: params.userTag },
      reason: params.reason,
      metadata: params.warningId ? { Avertissement: `#${params.warningId}` } : { Portée: "tous les avertissements actifs" },
      run: async () => {
        const res = await this.prisma.warning.updateMany({
          where: { guildId: guild.id, userId: params.userId, active: true, ...(params.warningId ? { id: params.warningId } : {}) },
          data: { active: false, clearedAt: new Date(), clearedBy: params.actor.id },
        });
        if (res.count === 0) throw new UserError(params.warningId ? "Avertissement introuvable ou déjà supprimé." : "Aucun avertissement actif pour ce membre.");
        cleared = res.count;
      },
    });
    return cleared;
  }

  /** Journalise une action ne nécessitant pas de logique particulière (clear, slowmode). */
  async recordSimple(params: { guild: Guild; type: "CLEAR_MESSAGES" | "SLOWMODE"; actor: Actor; target: { id: string; tag: string | null }; reason: string | null; metadata: Record<string, unknown>; run: () => Promise<unknown> }): Promise<SanctionResult> {
    return this.execute({ ...params, dm: null });
  }

  /** Lève les bannissements temporaires arrivés à expiration. */
  async processExpiredBans(): Promise<void> {
    const expired = await this.prisma.moderationAction.findMany({
      where: { type: "BAN", success: true, expired: false, expiresAt: { lte: new Date() } },
      take: 50,
    });
    for (const action of expired) {
      await this.prisma.moderationAction.update({ where: { id: action.id }, data: { expired: true } });
      const guild = this.client.guilds.cache.get(action.guildId);
      if (!guild) continue;
      try {
        await this.unban({
          guild,
          actor: { id: this.client.user!.id, tag: this.client.user!.tag, automatic: true },
          userId: action.targetId,
          reason: `Fin du bannissement temporaire (cas #${action.caseNumber})`,
        });
      } catch (err) {
        log.info({ err: describeError(err).message, guildId: guild.id }, "Débannissement automatique ignoré");
      }
    }
  }
}
