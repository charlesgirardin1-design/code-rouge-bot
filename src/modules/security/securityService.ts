import {
  AuditLogEvent,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildAuditLogsEntry,
  type GuildMember,
  type Message,
} from "discord.js";
import type { PrismaClient, Severity, SecurityEventType } from "../../database/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { GuildConfig } from "../../config/guildConfig.js";
import type { GuildConfigService } from "../../services/guildConfigService.js";
import type { ListService } from "../../services/listService.js";
import type { AuditService } from "../../services/auditService.js";
import type { StatsService } from "../../services/statsService.js";
import { auditEmbed, type LogService } from "../logs/logService.js";
import type { ModerationService, Actor } from "../moderation/moderationService.js";
import type { LockdownService } from "../lockdown/lockdownService.js";
import { Colors, securityEmbed, userLabel } from "../../bot/ui/embeds.js";
import { attempt, describeError } from "../../bot/errors.js";
import { DANGEROUS_PERMISSIONS } from "../../permissions/levels.js";
import { childLogger } from "../../utils/logger.js";
import { ExpiringMap } from "../../utils/timeWindow.js";
import { LEVEL_EMOJIS, LEVEL_LABELS, levelRank, RiskEngine, type RiskUpdate, type SecurityLevelName } from "./riskEngine.js";
import { AntiSpamEngine, VIOLATION_LABELS, type MessageRef } from "./antiSpam/engine.js";
import { RaidDetector } from "./antiRaid/engine.js";
import { NUKE_ACTION_LABELS, NukeTracker, type NukeAction, type NukeRecord } from "./antiNuke/engine.js";
import { computeAltRisk } from "./antiAlt/score.js";
import { BotAdditionTracker } from "./antiBot/analyzer.js";
import { analyzeMessage, PHISHING_REASON_LABELS } from "./antiPhishing/detector.js";
import { runSimulation, type SimulationKind, type SimulationResult } from "./simulation.js";

const log = childLogger("security");

const AUDIT_TO_NUKE: Partial<Record<AuditLogEvent, NukeAction>> = {
  [AuditLogEvent.ChannelDelete]: "channelDelete",
  [AuditLogEvent.ChannelCreate]: "channelCreate",
  [AuditLogEvent.RoleDelete]: "roleDelete",
  [AuditLogEvent.RoleCreate]: "roleCreate",
  [AuditLogEvent.MemberBanAdd]: "ban",
  [AuditLogEvent.MemberKick]: "kick",
  [AuditLogEvent.ChannelOverwriteCreate]: "permissionUpdate",
  [AuditLogEvent.ChannelOverwriteUpdate]: "permissionUpdate",
  [AuditLogEvent.ChannelOverwriteDelete]: "permissionUpdate",
  [AuditLogEvent.RoleUpdate]: "permissionUpdate",
  [AuditLogEvent.WebhookCreate]: "webhookCreate",
  [AuditLogEvent.GuildUpdate]: "guildUpdate",
};

const LINK_RE = /https?:\/\/\S+/gi;

export interface JoinOutcome {
  restricted: boolean;
}

export class SecurityService {
  readonly risk = new RiskEngine();
  private readonly spam = new AntiSpamEngine();
  private readonly raid = new RaidDetector();
  private readonly nuke = new NukeTracker();
  private readonly bots = new BotAdditionTracker();
  private readonly inviteCache = new ExpiringMap<string, string | null>(60 * 60_000);
  private readonly persistedScores = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaClient,
    private readonly configs: GuildConfigService,
    private readonly lists: ListService,
    private readonly logs: LogService,
    private readonly audit: AuditService,
    private readonly stats: StatsService,
    private readonly moderation: ModerationService,
    private readonly lockdown: LockdownService,
  ) {}

  private get botActor(): Actor {
    return { id: this.client.user!.id, tag: this.client.user!.tag, automatic: true };
  }

  // ─── Cycle de vie ─────────────────────────────────────────

  async restoreScores(guildIds: string[]): Promise<void> {
    const rows = await this.prisma.guildSettings.findMany({ where: { guildId: { in: guildIds } } });
    for (const row of rows) {
      this.risk.restore(row.guildId, row.securityScore, row.securityLevel, row.updatedAt.getTime());
      this.persistedScores.set(row.guildId, row.securityScore);
    }
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), 30_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Décroissance du score, persistance et purge des états en mémoire. */
  private async tick(): Promise<void> {
    const now = Date.now();
    this.spam.sweep(now);
    this.raid.sweep(now);
    this.nuke.sweep(now);
    this.bots.sweep(now);
    this.inviteCache.sweep(now);
    for (const guildId of this.risk.guildIds()) {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) continue;
      try {
        const config = await this.configs.get(guildId);
        const update = this.risk.tick(guildId, config.riskEngine, now);
        if (update.changed) await this.onRiskChange(guild, config, update, "Retour progressif à la normale");
        if (this.persistedScores.get(guildId) !== update.score) {
          await this.prisma.guildSettings.updateMany({ where: { guildId }, data: { securityScore: update.score, securityLevel: update.level } });
          this.persistedScores.set(guildId, update.score);
        }
      } catch (err) {
        log.error({ err, guildId }, "Erreur lors de la mise à jour du niveau de sécurité");
      }
    }
  }

  // ─── Moteur de risque ─────────────────────────────────────

  private async addRisk(guild: Guild, config: GuildConfig, points: number, reason: string, minimumLevel?: SecurityLevelName): Promise<RiskUpdate> {
    let update = this.risk.add(guild.id, points, config.riskEngine);
    if (minimumLevel && levelRank(minimumLevel) > levelRank(update.level)) {
      const raised = this.risk.raiseTo(guild.id, minimumLevel, config.riskEngine);
      update = { ...raised, previousLevel: update.previousLevel, changed: raised.level !== update.previousLevel };
    }
    if (update.changed) await this.onRiskChange(guild, config, update, reason);
    return update;
  }

  private async onRiskChange(guild: Guild, config: GuildConfig, update: RiskUpdate, reason: string): Promise<void> {
    const rising = levelRank(update.level) > levelRank(update.previousLevel);
    await this.recordEvent(guild.id, "LEVEL_CHANGE", rising ? (update.level === "LOCKDOWN" ? "CRITICAL" : "MEDIUM") : "LOW", update.level, {
      details: { from: update.previousLevel, to: update.level, score: update.score, reason },
    });
    await this.prisma.guildSettings.updateMany({ where: { guildId: guild.id }, data: { securityScore: update.score, securityLevel: update.level } });
    this.persistedScores.set(guild.id, update.score);

    const embed = securityEmbed(
      `${LEVEL_EMOJIS[update.level]} Niveau de sécurité : ${LEVEL_LABELS[update.level]}`,
      `${LEVEL_LABELS[update.previousLevel]} → **${LEVEL_LABELS[update.level]}**\n**Score de menace :** ${update.score}\n**Cause :** ${reason}`,
    ).setTimestamp();
    if (rising && levelRank(update.level) >= levelRank("REINFORCED")) await this.logs.alert(guild, embed);
    else await this.logs.send(guild, "security", { embeds: [embed] });

    if (update.level === "LOCKDOWN" && config.riskEngine.autoLockdown && !this.lockdown.isActive(guild.id)) {
      try {
        await this.lockdown.activate(guild, this.botActor, `Lockdown automatique : ${reason}`, true);
      } catch (err) {
        log.error({ err, guildId: guild.id }, "Échec du lockdown automatique");
      }
    }
    if (update.level === "NORMAL" && config.lockdown.autoUnlock && this.lockdown.isActive(guild.id)) {
      const state = await this.lockdown.state(guild.id);
      if (state?.automatic) {
        await attempt(this.lockdown.deactivate(guild, this.botActor, "Levée automatique : situation revenue à la normale", true));
      }
    }
  }

  private async recordEvent(
    guildId: string,
    type: SecurityEventType,
    severity: Severity,
    level: SecurityLevelName,
    extra: { userId?: string | null; executorId?: string | null; scoreDelta?: number; actionTaken?: string | null; details?: Record<string, unknown>; simulated?: boolean } = {},
  ): Promise<void> {
    try {
      await this.prisma.securityEvent.create({
        data: {
          guildId,
          type,
          severity,
          level,
          userId: extra.userId ?? null,
          executorId: extra.executorId ?? null,
          scoreDelta: extra.scoreDelta ?? 0,
          actionTaken: extra.actionTaken ?? null,
          simulated: extra.simulated ?? false,
          details: (extra.details ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      log.error({ err, guildId, type }, "Impossible d'enregistrer l'événement de sécurité");
    }
  }

  async resetScore(guild: Guild, actor: Actor): Promise<void> {
    this.risk.reset(guild.id);
    await this.prisma.guildSettings.updateMany({ where: { guildId: guild.id }, data: { securityScore: 0, securityLevel: "NORMAL" } });
    this.persistedScores.set(guild.id, 0);
    await this.audit.record({ guildId: guild.id, actorId: actor.id, actorType: "USER", action: "security.reset_score" });
  }

  // ─── Arrivées : anti-raid, anti-alt, anti-bot ─────────────

  async handleMemberJoin(member: GuildMember): Promise<JoinOutcome> {
    const guild = member.guild;
    const config = await this.configs.get(guild.id);
    if (member.user.bot) {
      if (config.antiBot.enabled) await this.handleBotJoin(member, config);
      return { restricted: false };
    }

    const now = Date.now();
    let duringRaid = levelRank(this.risk.peek(guild.id).level) >= levelRank("SURVEILLANCE");
    let similarToRecent = false;

    if (config.antiRaid.enabled) {
      const analysis = this.raid.recordJoin(
        { guildId: guild.id, userId: member.id, username: member.user.username, accountCreatedAt: member.user.createdTimestamp, hasAvatar: Boolean(member.user.avatar), timestamp: now },
        config.antiRaid,
        config.riskEngine.points,
      );
      similarToRecent = analysis.similarCount >= config.antiRaid.similarNameThreshold;
      duringRaid ||= analysis.wave || analysis.suggestedLevel !== "NORMAL";
      if (analysis.riskPoints > 0 || analysis.suggestedLevel !== "NORMAL") {
        const before = this.risk.peek(guild.id).level;
        const update = await this.addRisk(guild, config, analysis.riskPoints, `Vague d'arrivées : ${analysis.reasons.join(", ") || `${analysis.joinCount} arrivées`}`, analysis.suggestedLevel);
        if (levelRank(update.level) > levelRank(before) && levelRank(update.level) >= levelRank("SURVEILLANCE")) {
          this.stats.increment(guild.id, "raidsDetected");
          await this.recordEvent(guild.id, "RAID", update.level === "LOCKDOWN" ? "CRITICAL" : update.level === "REINFORCED" ? "HIGH" : "MEDIUM", update.level, {
            userId: member.id,
            scoreDelta: analysis.riskPoints,
            actionTaken: update.level === "LOCKDOWN" && config.riskEngine.autoLockdown ? "Lockdown automatique" : "Surveillance renforcée",
            details: { joinCount: analysis.joinCount, windowSeconds: config.antiRaid.windowSeconds, reasons: analysis.reasons, newAccountRatio: analysis.newAccountRatio },
          });
        }
      }
    }

    // Score de risque individuel
    const alt = computeAltRisk(
      { accountCreatedAt: member.user.createdTimestamp, hasAvatar: Boolean(member.user.avatar), username: member.user.username, duringRaid, similarToRecent, immediateActivity: false, now },
      config.antiAlt,
    );
    await attempt(
      this.prisma.$transaction([
        this.prisma.user.upsert({
          where: { id: member.id },
          create: { id: member.id, username: member.user.username, globalName: member.user.globalName, avatarHash: member.user.avatar, accountCreatedAt: member.user.createdAt },
          update: { username: member.user.username, globalName: member.user.globalName, avatarHash: member.user.avatar },
        }),
        this.prisma.memberProfile.upsert({
          where: { guildId_userId: { guildId: guild.id, userId: member.id } },
          create: { guildId: guild.id, userId: member.id, joinedAt: member.joinedAt, riskScore: alt.score, riskLevel: alt.level, riskReasons: alt.reasons },
          update: { joinedAt: member.joinedAt, leftAt: null, riskScore: alt.score, riskLevel: alt.level, riskReasons: alt.reasons },
        }),
      ]),
    );

    const unverified = config.verification.unverifiedRoleId;
    const level = this.risk.peek(guild.id).level;
    let restricted = false;
    let action = "Accès normal";

    if (this.lockdown.isActive(guild.id) && unverified) {
      const res = await this.lockdown.quarantine(member, unverified, config.verification.memberRoleId, "Arrivée pendant le lockdown");
      restricted = res.added;
      action = "Quarantaine (lockdown actif)";
    } else if (config.antiAlt.enabled && unverified) {
      const restrictForLevel = level === "REINFORCED" && alt.level !== "LOW";
      if ((alt.level === "HIGH" && config.antiAlt.restrictHigh) || (alt.level === "MEDIUM" && config.antiAlt.restrictMedium) || restrictForLevel) {
        const res = await this.lockdown.quarantine(member, unverified, config.verification.memberRoleId, `Compte à risque ${alt.level}`);
        restricted = res.added;
        action = alt.level === "HIGH" ? "Accès limité + alerte" : "Vérification requise";
      }
    }

    if (config.antiAlt.enabled && alt.level !== "LOW") {
      await this.recordEvent(guild.id, "ALT", alt.level === "HIGH" ? "HIGH" : "MEDIUM", level, {
        userId: member.id,
        actionTaken: action,
        details: { score: alt.score, reasons: alt.reasons },
      });
      if (alt.level === "HIGH") await this.addRisk(guild, config, config.riskEngine.points.highRiskAccount, "Compte à risque élevé");
      const embed = securityEmbed(alt.level === "HIGH" ? "Compte à risque élevé" : "Compte à risque moyen")
        .setColor(alt.level === "HIGH" ? Colors.error : Colors.warning)
        .addFields(
          { name: "Membre", value: userLabel(member.id, member.user.tag), inline: true },
          { name: "Score", value: `${alt.score}/100`, inline: true },
          { name: "Action", value: action, inline: true },
          { name: "Signaux", value: alt.reasons.map((r) => `• ${r}`).join("\n") || "—" },
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();
      await this.logs.send(guild, "security", { embeds: [embed], alert: alt.level === "HIGH" });
    }
    return { restricted };
  }

  private async handleBotJoin(member: GuildMember, config: GuildConfig): Promise<void> {
    const guild = member.guild;
    if (config.antiBot.trustedBotIds.includes(member.id)) return;
    const analysis = this.bots.analyze(guild.id, member.permissions.bitfield, config.antiBot);

    let inviterId: string | null = null;
    if (guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      const logsResult = await attempt(guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 }));
      inviterId = logsResult?.entries.find((e) => e.targetId === member.id)?.executorId ?? null;
    }

    let action = "Alerte";
    const severe = analysis.severity === "HIGH" || analysis.severity === "CRITICAL";
    if (severe && config.antiBot.action !== "alert") {
      try {
        if (config.antiBot.action === "kick" && member.kickable) {
          await member.kick("Anti-bot : bot à permissions dangereuses");
          action = "Bot expulsé";
        } else if (config.antiBot.action === "strip_roles") {
          action = await this.neutralizeMember(member, "Anti-bot : bot à permissions dangereuses");
        }
      } catch (err) {
        action = `Échec de la mitigation : ${describeError(err).message}`;
      }
    }

    await this.recordEvent(guild.id, "BOT_ADDED", analysis.severity, this.risk.peek(guild.id).level, {
      userId: member.id,
      executorId: inviterId,
      actionTaken: action,
      details: { dangerousPermissions: analysis.dangerousPermissions, botsAddedInWindow: analysis.botsAddedInWindow, tooManyBots: analysis.tooManyBots },
    });
    if (severe) await this.addRisk(guild, config, config.riskEngine.points.suspiciousBot, "Ajout d'un bot suspect");

    const embed = securityEmbed(severe ? "Bot à permissions dangereuses ajouté" : "Bot ajouté au serveur")
      .setColor(severe ? Colors.error : Colors.security)
      .addFields(
        { name: "Bot", value: userLabel(member.id, member.user.tag), inline: true },
        { name: "Ajouté par", value: inviterId ? `<@${inviterId}> (\`${inviterId}\`)` : "Inconnu", inline: true },
        { name: "Gravité", value: analysis.severity, inline: true },
        { name: "Permissions dangereuses", value: analysis.dangerousPermissions.join(", ") || "Aucune" },
        { name: "Bots ajoutés récemment", value: `${analysis.botsAddedInWindow} en ${config.antiBot.windowMinutes} min`, inline: true },
        { name: "Action", value: action, inline: true },
      )
      .setTimestamp();
    if (severe) await this.logs.alert(guild, embed);
    else await this.logs.send(guild, "security", { embeds: [embed] });
  }

  /**
   * Mitigation réversible : retire au membre les rôles dangereux gérables par le bot.
   * Pour un bot, son rôle géré (non retirable) voit ses permissions dangereuses désactivées.
   */
  private async neutralizeMember(member: GuildMember, reason: string): Promise<string> {
    const me = member.guild.members.me;
    if (!me) return "Impossible : permissions du bot inconnues";
    const removed: string[] = [];
    const neutralized: string[] = [];
    for (const role of member.roles.cache.values()) {
      if (role.id === member.guild.id || (role.permissions.bitfield & DANGEROUS_PERMISSIONS) === 0n || !role.editable) continue;
      if (role.managed) {
        const ok = await attempt(role.setPermissions(role.permissions.bitfield & ~DANGEROUS_PERMISSIONS, reason));
        if (ok) neutralized.push(`${role.name} (permissions précédentes : ${role.permissions.bitfield})`);
      } else {
        const ok = await attempt(member.roles.remove(role, reason));
        if (ok) removed.push(role.name);
      }
    }
    if (!removed.length && !neutralized.length) return "Aucun rôle gérable par le bot (hiérarchie) — alerte uniquement";
    return [removed.length ? `Rôles retirés : ${removed.join(", ")}` : "", neutralized.length ? `Rôles neutralisés : ${neutralized.join(", ")}` : ""].filter(Boolean).join(" ; ");
  }

  // ─── Messages : anti-spam, anti-phishing, activité immédiate ─

  /** Retourne true si le message a été supprimé par un module de sécurité. */
  async handleMessage(message: Message<true>): Promise<boolean> {
    const member = message.member;
    if (!member || message.author.bot || message.webhookId) return false;
    const guild = message.guild;
    const config = await this.configs.get(guild.id);
    // Le personnel de modération n'est pas soumis aux filtres automatiques.
    if (member.permissions.has(PermissionFlagsBits.ManageMessages) || member.id === guild.ownerId) return false;

    if (config.antiPhishing.enabled && !config.antiPhishing.ignoredRoleIds.some((r) => member.roles.cache.has(r))) {
      const handled = await this.checkPhishing(message, member, config);
      if (handled) return true;
    }

    if (config.antiRaid.enabled) await this.checkImmediateActivity(message, member, config);

    if (
      config.antiSpam.enabled &&
      !config.antiSpam.ignoredChannelIds.includes(message.channelId) &&
      !config.antiSpam.ignoredRoleIds.some((r) => member.roles.cache.has(r))
    ) {
      return this.checkSpam(message, member, config);
    }
    return false;
  }

  private async checkPhishing(message: Message<true>, member: GuildMember, config: GuildConfig): Promise<boolean> {
    const content = [message.content, ...message.embeds.map((e) => `${e.url ?? ""} ${e.description ?? ""}`)].join(" ");
    if (!/[a-z0-9-]\.[a-z]{2,}/i.test(content)) return false;
    const lists = await this.lists.get(message.guildId);
    const analysis = analyzeMessage(content, { config: config.antiPhishing, ...lists });

    const findings = [...analysis.findings];
    for (const code of analysis.inviteCodes) {
      if (config.antiPhishing.allowOwnInvites) {
        const guildId = await this.resolveInviteGuild(code);
        if (guildId === message.guildId) continue;
      }
      findings.push({ reason: "INVITE", value: code });
    }
    if (findings.length === 0) return false;

    const onlyInvites = findings.every((f) => f.reason === "INVITE");
    const deleted = (await attempt(message.delete())) !== null;
    if (deleted) this.stats.increment(message.guildId, "messagesDeleted");
    this.stats.increment(message.guildId, "linksBlocked");

    let action = deleted ? "Message supprimé" : "Suppression impossible";
    const reasonText = findings.map((f) => `${PHISHING_REASON_LABELS[f.reason]} (${f.value})`).join(", ");
    if (!onlyInvites && config.antiPhishing.action === "delete_timeout" && member.moderatable) {
      const res = await attempt(
        this.moderation.timeout({ guild: message.guild, actor: this.botActor, member, durationMs: config.antiPhishing.timeoutMinutes * 60_000, reason: `Anti-phishing : ${reasonText}`.slice(0, 400) }),
      );
      if (res) action += ` + exclusion ${config.antiPhishing.timeoutMinutes} min`;
    }
    if (onlyInvites || config.antiPhishing.action !== "delete") {
      const notice = await attempt(
        message.channel.send({
          content: `${member.toString()}, ${onlyInvites ? "les invitations vers d'autres serveurs ne sont pas autorisées ici." : "ton message contenait un lien dangereux et a été supprimé."}`,
          allowedMentions: { users: [member.id] },
        }),
      );
      if (notice) setTimeout(() => void attempt(notice.delete()), 8000).unref();
    }

    if (!onlyInvites) {
      await this.recordEvent(message.guildId, "PHISHING", "HIGH", this.risk.peek(message.guildId).level, {
        userId: member.id,
        actionTaken: action,
        details: { findings, channelId: message.channelId, content: message.content.slice(0, 500) },
      });
      await this.addRisk(message.guild, config, config.riskEngine.points.phishing, "Lien de phishing détecté");
    }

    await this.logs.send(message.guild, "security", {
      embeds: [
        securityEmbed(onlyInvites ? "Invitation non autorisée bloquée" : "Lien suspect bloqué")
          .setColor(onlyInvites ? Colors.warning : Colors.error)
          .addFields(
            { name: "Membre", value: userLabel(member.id, member.user.tag), inline: true },
            { name: "Salon", value: `<#${message.channelId}>`, inline: true },
            { name: "Action", value: action, inline: true },
            { name: "Détection", value: reasonText.slice(0, 1024) },
            { name: "Contenu", value: `\`\`\`${message.content.replace(/`/g, "ˋ").slice(0, 900) || "(vide)"}\`\`\`` },
          )
          .setTimestamp(),
      ],
    });
    return true;
  }

  private async resolveInviteGuild(code: string): Promise<string | null> {
    const cached = this.inviteCache.get(code);
    if (cached !== undefined) return cached;
    const invite = await attempt(this.client.fetchInvite(code));
    const guildId = invite?.guild?.id ?? null;
    this.inviteCache.set(code, guildId);
    return guildId;
  }

  private async checkImmediateActivity(message: Message<true>, member: GuildMember, config: GuildConfig): Promise<void> {
    const since = this.raid.timeSinceJoin(message.guildId, member.id);
    if (since === null || since > config.antiRaid.immediateActivitySeconds * 1000) return;
    const suspicious = LINK_RE.test(message.content) || message.mentions.users.size + message.mentions.roles.size >= 3 || message.mentions.everyone;
    LINK_RE.lastIndex = 0;
    if (!suspicious || !config.antiAlt.enabled) return;

    const alt = computeAltRisk(
      {
        accountCreatedAt: member.user.createdTimestamp,
        hasAvatar: Boolean(member.user.avatar),
        username: member.user.username,
        duringRaid: levelRank(this.risk.peek(message.guildId).level) >= levelRank("SURVEILLANCE"),
        similarToRecent: false,
        immediateActivity: true,
        now: Date.now(),
      },
      config.antiAlt,
    );
    await attempt(
      this.prisma.memberProfile.updateMany({
        where: { guildId: message.guildId, userId: member.id },
        data: { riskScore: alt.score, riskLevel: alt.level, riskReasons: alt.reasons },
      }),
    );
    if (alt.level === "HIGH" && config.antiAlt.restrictHigh && config.verification.unverifiedRoleId) {
      await this.lockdown.quarantine(member, config.verification.unverifiedRoleId, config.verification.memberRoleId, "Activité suspecte juste après l'arrivée");
      await this.recordEvent(message.guildId, "ALT", "HIGH", this.risk.peek(message.guildId).level, {
        userId: member.id,
        actionTaken: "Accès limité",
        details: { score: alt.score, reasons: alt.reasons, secondsAfterJoin: Math.round(since / 1000) },
      });
      await this.logs.send(message.guild, "security", {
        alert: true,
        embeds: [
          securityEmbed("Activité suspecte juste après l'arrivée")
            .setColor(Colors.error)
            .addFields(
              { name: "Membre", value: userLabel(member.id, member.user.tag), inline: true },
              { name: "Délai", value: `${Math.round(since / 1000)} s après l'arrivée`, inline: true },
              { name: "Score", value: `${alt.score}/100`, inline: true },
              { name: "Action", value: "Accès limité (rôle non vérifié)" },
            ),
        ],
      });
    }
  }

  private async checkSpam(message: Message<true>, member: GuildMember, config: GuildConfig): Promise<boolean> {
    const verdict = this.spam.evaluate(
      {
        guildId: message.guildId,
        userId: member.id,
        channelId: message.channelId,
        messageId: message.id,
        content: message.content,
        mentionCount: message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 5 : 0),
        linkCount: (message.content.match(LINK_RE) ?? []).length,
        timestamp: message.createdTimestamp,
      },
      config.antiSpam,
    );
    if (verdict.action === "none") {
      // Résidu d'une rafale déjà sanctionnée : suppression silencieuse.
      if (verdict.toDelete.length === 0) return false;
      const removed = await this.deleteMessages(message.guild, verdict.toDelete);
      if (removed > 0) this.stats.increment(message.guildId, "messagesDeleted", removed);
      return removed > 0;
    }

    const deleted = await this.deleteMessages(message.guild, verdict.toDelete);
    if (deleted > 0) this.stats.increment(message.guildId, "messagesDeleted", deleted);
    const reasons = [...new Set(verdict.violations)].map((v) => VIOLATION_LABELS[v]).join(", ");

    if (verdict.action === "warn") {
      if (verdict.notify) {
        const notice = await attempt(
          message.channel.send({ content: `🟡 ${member.toString()}, merci de ralentir : ${reasons.toLowerCase()}.`, allowedMentions: { users: [member.id] } }),
        );
        if (notice) setTimeout(() => void attempt(notice.delete()), 6000).unref();
      }
      return deleted > 0 && verdict.toDelete.some((m) => m.messageId === message.id);
    }

    // Timeout (normal ou long)
    this.stats.increment(message.guildId, "spamDetected");
    let action = `Suppression de ${deleted} message(s)`;
    if (member.moderatable) {
      const res = await attempt(
        this.moderation.timeout({ guild: message.guild, actor: this.botActor, member, durationMs: verdict.timeoutMinutes * 60_000, reason: `Anti-spam : ${reasons}`.slice(0, 400) }),
      );
      if (res) action += ` + exclusion ${verdict.timeoutMinutes} min`;
    } else {
      action += " (exclusion impossible : hiérarchie)";
    }
    const notice = await attempt(
      message.channel.send({ content: `🔴 ${member.toString()} a été exclu temporairement pour spam.`, allowedMentions: { users: [] } }),
    );
    if (notice) setTimeout(() => void attempt(notice.delete()), 8000).unref();

    await this.recordEvent(message.guildId, "SPAM", verdict.action === "severe_timeout" ? "HIGH" : "MEDIUM", this.risk.peek(message.guildId).level, {
      userId: member.id,
      scoreDelta: config.riskEngine.points.spam,
      actionTaken: action,
      details: { violations: verdict.violations, channelId: message.channelId, deleted },
    });
    await this.addRisk(message.guild, config, config.riskEngine.points.spam, `Spam de ${member.user.tag}`);
    await this.logs.send(message.guild, "security", {
      embeds: [
        securityEmbed("Spam détecté")
          .setColor(Colors.warning)
          .addFields(
            { name: "Membre", value: userLabel(member.id, member.user.tag), inline: true },
            { name: "Salon", value: `<#${message.channelId}>`, inline: true },
            { name: "Action", value: action, inline: true },
            { name: "Infractions", value: reasons },
          )
          .setTimestamp(),
      ],
    });
    return true;
  }

  private async deleteMessages(guild: Guild, refs: MessageRef[]): Promise<number> {
    const byChannel = new Map<string, string[]>();
    for (const ref of refs) byChannel.set(ref.channelId, [...(byChannel.get(ref.channelId) ?? []), ref.messageId]);
    let count = 0;
    for (const [channelId, ids] of byChannel) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel?.isTextBased() || !guild.members.me?.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages)) continue;
      if (ids.length === 1) {
        if (await attempt(channel.messages.delete(ids[0]!))) count++;
        else count += 0;
      } else {
        const res = await attempt(channel.bulkDelete(ids, true));
        count += res?.size ?? 0;
      }
    }
    return count;
  }

  // ─── Anti-nuke ────────────────────────────────────────────

  async handleAuditLogEntry(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
    const action = AUDIT_TO_NUKE[entry.action];
    if (!action || !entry.executorId) return;
    if (entry.executorId === this.client.user?.id) return;
    // Une mise à jour de rôle n'est surveillée que si elle touche aux permissions.
    if (entry.action === AuditLogEvent.RoleUpdate && !entry.changes.some((c) => c.key === "permissions")) return;

    const config = await this.configs.get(guild.id);
    if (!config.antiNuke.enabled || config.antiNuke.trustedUserIds.includes(entry.executorId)) return;

    const target = entry.target as { id?: string; name?: string } | null;
    const record: NukeRecord = {
      action,
      executorId: entry.executorId,
      targetId: entry.targetId ?? null,
      targetName: target && "name" in target ? (target.name ?? null) : null,
      details: { changes: entry.changes.slice(0, 10).map((c) => ({ key: c.key, old: stringify(c.old), new: stringify(c.new) })) },
    };
    const verdict = this.nuke.record(guild.id, record, config.antiNuke);
    if (!verdict.triggered) return;

    this.stats.increment(guild.id, "nukeDetected");
    const executor = await guild.members.fetch(entry.executorId).catch(() => null);
    let mitigation = "Alerte uniquement";
    if (entry.executorId === guild.ownerId) {
      mitigation = "Alerte uniquement (propriétaire du serveur)";
    } else if (executor && config.antiNuke.mitigation === "strip_roles") {
      mitigation = await this.neutralizeMember(executor, `Anti-nuke : ${NUKE_ACTION_LABELS[action]} massives`);
    } else if (config.antiNuke.mitigation === "ban") {
      const res = await attempt(
        this.moderation.ban({ guild, actor: this.botActor, user: executor?.user ?? (await this.client.users.fetch(entry.executorId)), reason: `Anti-nuke : ${NUKE_ACTION_LABELS[action]} massives` }),
      );
      mitigation = res ? "Auteur banni" : "Bannissement impossible (hiérarchie ou permissions)";
    }

    await this.recordEvent(guild.id, "NUKE", "CRITICAL", this.risk.peek(guild.id).level, {
      executorId: entry.executorId,
      scoreDelta: config.riskEngine.points.nuke,
      actionTaken: mitigation,
      details: { action, count: verdict.count, windowSeconds: config.antiNuke.windowSeconds, affected: verdict.recent },
    });
    await this.addRisk(guild, config, config.riskEngine.points.nuke, `Comportement administratif suspect : ${NUKE_ACTION_LABELS[action]}`);

    const affected = verdict.recent
      .map((r) => `• ${r.targetName ?? "?"} (\`${r.targetId ?? "?"}\`)`)
      .join("\n")
      .slice(0, 1000);
    await this.logs.alert(
      guild,
      auditEmbed({
        action: "🚨 ANTI-NUKE — Comportement critique",
        actor: executor ? `${executor.toString()} (${executor.user.tag} · \`${executor.id}\`)` : `\`${entry.executorId}\``,
        target: NUKE_ACTION_LABELS[action],
        reason: `${verdict.count} action(s) en ${config.antiNuke.windowSeconds}s (seuil : ${verdict.threshold})`,
        result: mitigation,
        color: Colors.error,
        extra: [{ name: "Éléments concernés", value: affected || "—" }],
      }),
    );
    await this.audit.record({
      guildId: guild.id,
      actorId: this.client.user!.id,
      actorType: "BOT",
      action: "security.antinuke",
      targetId: entry.executorId,
      targetType: "user",
      reason: `${NUKE_ACTION_LABELS[action]} : ${verdict.count} en ${config.antiNuke.windowSeconds}s`,
      details: { mitigation },
    });
  }

  // ─── Simulation ───────────────────────────────────────────

  async simulate(guild: Guild, kind: SimulationKind, actor: Actor): Promise<SimulationResult> {
    const config = await this.configs.get(guild.id);
    const result = runSimulation(kind, config, this.lockdown.isActive(guild.id));
    await this.recordEvent(guild.id, result.eventType, result.severity, this.risk.peek(guild.id).level, {
      executorId: actor.id,
      simulated: true,
      actionTaken: result.action,
      details: { simulation: kind, details: result.details },
    });
    await this.audit.record({ guildId: guild.id, actorId: actor.id, actorType: "USER", action: "security.simulation", details: { kind, action: result.action } });
    return result;
  }
}

function stringify(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return (typeof value === "string" ? value : JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))).slice(0, 200);
  } catch {
    return String(value).slice(0, 200);
  }
}
