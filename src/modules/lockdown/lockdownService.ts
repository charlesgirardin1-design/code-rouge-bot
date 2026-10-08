import { GuildFeature, GuildVerificationLevel, OverwriteType, PermissionFlagsBits, Routes, type Guild, type GuildMember } from "discord.js";
import type { PrismaClient } from "../../database/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { GuildConfigService } from "../../services/guildConfigService.js";
import type { AuditService } from "../../services/auditService.js";
import { auditEmbed, type LogService } from "../logs/logService.js";
import { Colors } from "../../bot/ui/embeds.js";
import { attempt, UserError } from "../../bot/errors.js";
import type { Actor } from "../moderation/moderationService.js";
import { childLogger } from "../../utils/logger.js";

const log = childLogger("lockdown");

interface OverwriteSnapshot {
  channelId: string;
  roleId: string;
  existed: boolean;
  allow: string;
  deny: string;
}

export interface LockdownSnapshot {
  verificationLevel: number | null;
  invitesPaused: boolean;
  overwrites: OverwriteSnapshot[];
  quarantined: string[];
  removedMemberRole: string[];
}

export interface LockdownSummary {
  steps: string[];
  warnings: string[];
}

const LOCKED_TEXT_PERMS =
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.SendMessagesInThreads |
  PermissionFlagsBits.CreatePublicThreads |
  PermissionFlagsBits.CreatePrivateThreads |
  PermissionFlagsBits.AddReactions;

/**
 * Lockdown contrôlé et réversible : chaque modification est enregistrée dans un instantané
 * (LockdownState.snapshot) puis restaurée exactement à la levée du lockdown.
 */
export class LockdownService {
  private readonly active = new Set<string>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly configs: GuildConfigService,
    private readonly logs: LogService,
    private readonly audit: AuditService,
  ) {}

  async loadActive(): Promise<void> {
    const rows = await this.prisma.lockdownState.findMany({ where: { active: true }, select: { guildId: true } });
    for (const r of rows) this.active.add(r.guildId);
  }

  isActive(guildId: string): boolean {
    return this.active.has(guildId);
  }

  async state(guildId: string) {
    return this.prisma.lockdownState.findUnique({ where: { guildId } });
  }

  async activate(guild: Guild, actor: Actor, reason: string, automatic = false): Promise<LockdownSummary> {
    if (this.active.has(guild.id)) throw new UserError("Le lockdown est déjà actif sur ce serveur.");
    this.active.add(guild.id);
    const config = await this.configs.get(guild.id);
    const me = guild.members.me;
    const steps: string[] = [];
    const warnings: string[] = [];
    const snapshot: LockdownSnapshot = { verificationLevel: null, invitesPaused: false, overwrites: [], quarantined: [], removedMemberRole: [] };

    try {
      // 1. Niveau de vérification Discord
      if (config.lockdown.raiseVerificationLevel && guild.verificationLevel < GuildVerificationLevel.High) {
        if (me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
          snapshot.verificationLevel = guild.verificationLevel;
          await guild.setVerificationLevel(GuildVerificationLevel.High, `Lockdown : ${reason}`);
          steps.push("Niveau de vérification Discord relevé à « Élevé »");
        } else warnings.push("Permission « Gérer le serveur » manquante : niveau de vérification inchangé");
      }

      // 2. Suspension des invitations
      if (config.lockdown.pauseInvites && !guild.features.includes(GuildFeature.InvitesDisabled)) {
        if (me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
          const ok = await attempt(guild.disableInvites(true));
          if (ok) {
            snapshot.invitesPaused = true;
            steps.push("Invitations du serveur suspendues");
          } else warnings.push("Impossible de suspendre les invitations");
        }
      }

      // 3. Salons sensibles : rôle non vérifié (ou @everyone à défaut) restreint
      const restrictedRoleId = config.verification.unverifiedRoleId ?? guild.roles.everyone.id;
      const usingEveryone = restrictedRoleId === guild.roles.everyone.id;
      for (const channelId of config.lockdown.sensitiveChannelIds) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || channel.isThread() || !("permissionOverwrites" in channel)) {
          warnings.push(`Salon sensible introuvable : ${channelId}`);
          continue;
        }
        if (!me?.permissionsIn(channel).has(PermissionFlagsBits.ManageRoles)) {
          warnings.push(`Permission « Gérer les permissions » manquante dans ${channel.toString()}`);
          continue;
        }
        const existing = channel.permissionOverwrites.cache.get(restrictedRoleId);
        snapshot.overwrites.push({
          channelId,
          roleId: restrictedRoleId,
          existed: Boolean(existing),
          allow: (existing?.allow.bitfield ?? 0n).toString(),
          deny: (existing?.deny.bitfield ?? 0n).toString(),
        });
        const extraDeny = usingEveryone ? LOCKED_TEXT_PERMS : PermissionFlagsBits.ViewChannel;
        const allow = (existing?.allow.bitfield ?? 0n) & ~extraDeny;
        const deny = (existing?.deny.bitfield ?? 0n) | extraDeny;
        await guild.client.rest.put(Routes.channelPermission(channelId, restrictedRoleId), {
          body: { type: OverwriteType.Role, allow: allow.toString(), deny: deny.toString() },
          reason: `Lockdown : ${reason}`,
        });
      }
      if (snapshot.overwrites.length) {
        steps.push(`${snapshot.overwrites.length} salon(s) sensible(s) restreint(s) pour ${usingEveryone ? "@everyone (écriture)" : "le rôle non vérifié (accès)"}`);
      }

      // 4. Quarantaine des arrivées récentes
      if (config.lockdown.quarantineRecentMinutes > 0) {
        const unverified = config.verification.unverifiedRoleId;
        if (!unverified) warnings.push("Aucun rôle non vérifié configuré : quarantaine des arrivées récentes impossible");
        else {
          const since = Date.now() - config.lockdown.quarantineRecentMinutes * 60_000;
          const recent = guild.members.cache.filter((m) => !m.user.bot && (m.joinedTimestamp ?? 0) >= since && !m.permissions.has(PermissionFlagsBits.ManageMessages));
          for (const member of recent.values()) {
            const res = await this.quarantine(member, unverified, config.verification.memberRoleId, reason);
            if (res.added) snapshot.quarantined.push(member.id);
            if (res.removedMember) snapshot.removedMemberRole.push(member.id);
          }
          if (snapshot.quarantined.length) steps.push(`${snapshot.quarantined.length} membre(s) arrivé(s) récemment placé(s) en quarantaine`);
        }
      }
      steps.push("Nouvelles arrivées placées automatiquement en quarantaine");
    } catch (err) {
      log.error({ err, guildId: guild.id }, "Erreur pendant l'activation du lockdown");
      warnings.push("Une erreur est survenue pendant l'activation : certaines mesures n'ont pas été appliquées");
    }

    await this.prisma.lockdownState.upsert({
      where: { guildId: guild.id },
      create: { guildId: guild.id, active: true, automatic, reason, startedBy: actor.id, startedAt: new Date(), snapshot: snapshot as unknown as Prisma.InputJsonValue },
      update: { active: true, automatic, reason, startedBy: actor.id, startedAt: new Date(), endedAt: null, endedBy: null, snapshot: snapshot as unknown as Prisma.InputJsonValue },
    });
    await this.prisma.securityEvent.create({
      data: { guildId: guild.id, type: "LOCKDOWN", severity: "CRITICAL", executorId: actor.id, level: "LOCKDOWN", actionTaken: steps.join(" ; "), details: { reason, automatic, warnings } },
    });
    await this.audit.record({ guildId: guild.id, actorId: actor.id, actorType: automatic ? "BOT" : "USER", action: "lockdown.activate", reason, details: { steps, warnings } });
    await this.logs.alert(
      guild,
      auditEmbed({
        action: "🔴 LOCKDOWN ACTIVÉ",
        actor: automatic ? "Système de sécurité (automatique)" : `<@${actor.id}> (${actor.tag})`,
        target: "Serveur",
        reason,
        result: steps.length ? steps.map((s) => `• ${s}`).join("\n") : "Aucune mesure applicable (vérifiez la configuration)",
        color: Colors.error,
        extra: warnings.length ? [{ name: "Avertissements", value: warnings.map((w) => `• ${w}`).join("\n") }] : [],
      }),
    );
    return { steps, warnings };
  }

  /** Applique la quarantaine à un membre (arrivée pendant le lockdown). */
  async quarantine(member: GuildMember, unverifiedRoleId: string, memberRoleId: string | null, reason: string): Promise<{ added: boolean; removedMember: boolean }> {
    let added = false;
    let removedMember = false;
    if (!member.manageable) return { added, removedMember };
    if (!member.roles.cache.has(unverifiedRoleId)) added = (await attempt(member.roles.add(unverifiedRoleId, `Quarantaine : ${reason}`))) !== null;
    if (memberRoleId && member.roles.cache.has(memberRoleId)) removedMember = (await attempt(member.roles.remove(memberRoleId, `Quarantaine : ${reason}`))) !== null;
    return { added, removedMember };
  }

  async deactivate(guild: Guild, actor: Actor, reason: string, automatic = false): Promise<LockdownSummary> {
    const state = await this.prisma.lockdownState.findUnique({ where: { guildId: guild.id } });
    if (!state?.active) {
      this.active.delete(guild.id);
      throw new UserError("Aucun lockdown n'est actif sur ce serveur.");
    }
    const config = await this.configs.get(guild.id);
    const snapshot = (state.snapshot ?? {}) as Partial<LockdownSnapshot>;
    const steps: string[] = [];
    const warnings: string[] = [];

    if (snapshot.verificationLevel !== null && snapshot.verificationLevel !== undefined) {
      const ok = await attempt(guild.setVerificationLevel(snapshot.verificationLevel, `Fin du lockdown : ${reason}`));
      if (ok) steps.push("Niveau de vérification Discord restauré");
      else warnings.push("Impossible de restaurer le niveau de vérification");
    }
    if (snapshot.invitesPaused) {
      const ok = await attempt(guild.disableInvites(false));
      if (ok) steps.push("Invitations réactivées");
      else warnings.push("Impossible de réactiver les invitations");
    }
    let restored = 0;
    for (const ow of snapshot.overwrites ?? []) {
      const ok = await attempt(async () => {
        if (ow.existed) {
          await guild.client.rest.put(Routes.channelPermission(ow.channelId, ow.roleId), {
            body: { type: OverwriteType.Role, allow: ow.allow, deny: ow.deny },
            reason: `Fin du lockdown : ${reason}`,
          });
        } else {
          await guild.client.rest.delete(Routes.channelPermission(ow.channelId, ow.roleId), { reason: `Fin du lockdown : ${reason}` });
        }
      });
      if (ok !== null) restored++;
      else warnings.push(`Permissions non restaurées pour le salon ${ow.channelId}`);
    }
    if (restored) steps.push(`Permissions de ${restored} salon(s) restaurées`);

    // Si la vérification est active, les membres en quarantaine passent par le bouton de vérification.
    if (!config.verification.enabled && config.verification.unverifiedRoleId) {
      let released = 0;
      for (const id of snapshot.quarantined ?? []) {
        const member = await guild.members.fetch(id).catch(() => null);
        if (!member) continue;
        await attempt(member.roles.remove(config.verification.unverifiedRoleId, "Fin du lockdown"));
        if (config.verification.memberRoleId && snapshot.removedMemberRole?.includes(id)) await attempt(member.roles.add(config.verification.memberRoleId, "Fin du lockdown"));
        released++;
      }
      if (released) steps.push(`${released} membre(s) sorti(s) de quarantaine`);
    } else if (snapshot.quarantined?.length) {
      steps.push(`${snapshot.quarantined.length} membre(s) en quarantaine doivent effectuer la vérification`);
    }

    this.active.delete(guild.id);
    await this.prisma.lockdownState.update({ where: { guildId: guild.id }, data: { active: false, endedAt: new Date(), endedBy: actor.id } });
    await this.prisma.securityEvent.create({
      data: { guildId: guild.id, type: "UNLOCK", severity: "LOW", executorId: actor.id, level: "NORMAL", actionTaken: steps.join(" ; "), details: { reason, automatic, warnings } },
    });
    await this.audit.record({ guildId: guild.id, actorId: actor.id, actorType: automatic ? "BOT" : "USER", action: "lockdown.deactivate", reason, details: { steps, warnings } });
    await this.logs.send(guild, "security", {
      embeds: [
        auditEmbed({
          action: "🟢 Lockdown levé",
          actor: automatic ? "Système de sécurité (automatique)" : `<@${actor.id}> (${actor.tag})`,
          target: "Serveur",
          reason,
          result: steps.length ? steps.map((s) => `• ${s}`).join("\n") : "Rien à restaurer",
          color: Colors.success,
          extra: warnings.length ? [{ name: "Avertissements", value: warnings.map((w) => `• ${w}`).join("\n") }] : [],
        }),
      ],
    });
    return { steps, warnings };
  }
}
