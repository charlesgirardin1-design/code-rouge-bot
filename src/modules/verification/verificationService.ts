import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, type GuildMember, type GuildTextBasedChannel, type Message } from "discord.js";
import type { PrismaClient } from "../../database/client.js";
import type { GuildConfig } from "../../config/guildConfig.js";
import type { GuildConfigService } from "../../services/guildConfigService.js";
import type { StatsService } from "../../services/statsService.js";
import type { AuditService } from "../../services/auditService.js";
import type { LockdownService } from "../lockdown/lockdownService.js";
import { auditEmbed, type LogService } from "../logs/logService.js";
import { Colors } from "../../bot/ui/embeds.js";
import { attempt, UserError } from "../../bot/errors.js";
import { formatDuration } from "../../utils/duration.js";
import type { Actor } from "../moderation/moderationService.js";

export const VERIFY_BUTTON_ID = "verify:start";

export class VerificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly configs: GuildConfigService,
    private readonly lockdown: LockdownService,
    private readonly logs: LogService,
    private readonly stats: StatsService,
    private readonly audit: AuditService,
  ) {}

  /** Vérifie que la configuration de vérification est exploitable par le bot. */
  assertUsable(member: GuildMember, config: GuildConfig): { memberRoleId: string; unverifiedRoleId: string | null } {
    const v = config.verification;
    if (!v.enabled) throw new UserError("La vérification n'est pas activée sur ce serveur (`/config set verification.enabled true`).");
    if (!v.memberRoleId) throw new UserError("Aucun rôle membre n'est configuré (`verification.memberRoleId`).");
    const me = member.guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new UserError("Il me manque la permission « Gérer les rôles ».");
    for (const roleId of [v.memberRoleId, v.unverifiedRoleId]) {
      if (!roleId) continue;
      const role = member.guild.roles.cache.get(roleId);
      if (!role) throw new UserError(`Le rôle configuré \`${roleId}\` n'existe plus.`);
      if (role.position >= me.roles.highest.position) throw new UserError(`Le rôle ${role.toString()} est au-dessus de mon rôle le plus élevé : je ne peux pas l'attribuer.`);
    }
    return { memberRoleId: v.memberRoleId, unverifiedRoleId: v.unverifiedRoleId };
  }

  async sendPanel(channel: GuildTextBasedChannel, config: GuildConfig): Promise<Message> {
    const embed = new EmbedBuilder().setColor(Colors.info).setTitle("✅ Vérification").setDescription(config.verification.message);
    if (config.verification.rules) embed.addFields({ name: "📜 Règlement", value: config.verification.rules.slice(0, 1024) });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(VERIFY_BUTTON_ID).setLabel("Vérifier mon compte").setEmoji("✅").setStyle(ButtonStyle.Success),
    );
    return channel.send({ embeds: [embed], components: [row] });
  }

  /** À l'arrivée : attribue le rôle non vérifié si la vérification est active. */
  async onJoin(member: GuildMember): Promise<void> {
    const config = await this.configs.get(member.guild.id);
    const roleId = config.verification.unverifiedRoleId;
    if (!config.verification.enabled || !roleId || member.user.bot || member.roles.cache.has(roleId)) return;
    await attempt(member.roles.add(roleId, "Vérification requise"));
  }

  /** Traitement du bouton « Vérifier mon compte ». Retourne le message à afficher. */
  async verifySelf(member: GuildMember): Promise<string> {
    const config = await this.configs.get(member.guild.id);
    const { memberRoleId, unverifiedRoleId } = this.assertUsable(member, config);
    const v = config.verification;

    if (member.roles.cache.has(memberRoleId) && (!unverifiedRoleId || !member.roles.cache.has(unverifiedRoleId))) {
      return "Votre compte est déjà vérifié.";
    }
    if (v.blockDuringLockdown && this.lockdown.isActive(member.guild.id)) {
      throw new UserError("Le serveur est temporairement en lockdown. Les vérifications reprendront bientôt, merci de patienter.", "Vérification suspendue");
    }
    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    if (v.minAccountAgeHours > 0 && accountAgeMs < v.minAccountAgeHours * 3_600_000) {
      throw new UserError(`Votre compte Discord doit avoir au moins ${v.minAccountAgeHours} h pour accéder au serveur. Réessayez dans ${formatDuration(v.minAccountAgeHours * 3_600_000 - accountAgeMs)}.`, "Compte trop récent");
    }
    const sinceJoin = Date.now() - (member.joinedTimestamp ?? 0);
    if (v.minDelaySeconds > 0 && sinceJoin < v.minDelaySeconds * 1000) {
      throw new UserError(`Merci de prendre le temps de lire le règlement. Vous pourrez vous vérifier dans ${formatDuration(v.minDelaySeconds * 1000 - sinceJoin)}.`, "Un instant…");
    }

    await this.applyVerification(member, memberRoleId, unverifiedRoleId, "Vérification par bouton");
    await this.logs.send(member.guild, "members", {
      embeds: [
        auditEmbed({
          action: "✅ Membre vérifié",
          actor: `${member.toString()} (${member.user.tag})`,
          target: `${member.toString()} (\`${member.id}\`)`,
          reason: "Vérification par bouton",
          result: "Succès",
          color: Colors.success,
          extra: [{ name: "Âge du compte", value: formatDuration(accountAgeMs), inline: true }],
        }),
      ],
    });
    return "Votre compte est vérifié. Bienvenue sur le serveur !";
  }

  /** Vérification manuelle par un modérateur (/verify user). */
  async verifyManually(member: GuildMember, actor: Actor): Promise<void> {
    const config = await this.configs.get(member.guild.id);
    const { memberRoleId, unverifiedRoleId } = this.assertUsable(member, config);
    if (!member.manageable) throw new UserError("Je ne peux pas modifier les rôles de ce membre (hiérarchie).");
    await this.applyVerification(member, memberRoleId, unverifiedRoleId, `Vérification manuelle par ${actor.tag}`);
    await this.audit.record({ guildId: member.guild.id, actorId: actor.id, actorType: "USER", action: "verification.manual", targetId: member.id, targetType: "user" });
    await this.logs.send(member.guild, "members", {
      embeds: [auditEmbed({ action: "✅ Membre vérifié manuellement", actor: `<@${actor.id}> (${actor.tag})`, target: `${member.toString()} (\`${member.id}\`)`, result: "Succès", color: Colors.success })],
    });
  }

  private async applyVerification(member: GuildMember, memberRoleId: string, unverifiedRoleId: string | null, reason: string): Promise<void> {
    await member.roles.add(memberRoleId, reason);
    if (unverifiedRoleId && member.roles.cache.has(unverifiedRoleId)) await member.roles.remove(unverifiedRoleId, reason);
    this.stats.increment(member.guild.id, "membersVerified");
    await attempt(
      this.prisma.memberProfile.upsert({
        where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
        create: { guild: { connect: { id: member.guild.id } }, user: { connectOrCreate: { where: { id: member.id }, create: { id: member.id, username: member.user.username, accountCreatedAt: member.user.createdAt } } }, joinedAt: member.joinedAt, verifiedAt: new Date() },
        update: { verifiedAt: new Date() },
      }),
    );
  }
}
