import { type PermissionFlagsBits, PermissionsBitField, type GuildMember, type GuildBasedChannel, type PermissionResolvable } from "discord.js";
import type { GuildConfig } from "../../config/guildConfig.js";
import { checkHierarchy, computePermissionLevel, HIERARCHY_MESSAGES, type PermissionLevel, PERMISSION_LEVEL_NAMES } from "../../permissions/levels.js";
import { UserError } from "../errors.js";

export function memberLevel(member: GuildMember, config: GuildConfig): PermissionLevel {
  return computePermissionLevel({
    userId: member.id,
    ownerId: member.guild.ownerId,
    permissions: member.permissions.bitfield,
    roleIds: [...member.roles.cache.keys()],
    config: config.permissions,
  });
}

export function requireLevel(member: GuildMember, config: GuildConfig, required: PermissionLevel): void {
  const level = memberLevel(member, config);
  if (level < required) {
    throw new UserError(`Cette action nécessite le niveau **${PERMISSION_LEVEL_NAMES[required]}** (votre niveau : ${PERMISSION_LEVEL_NAMES[level]}).`, "Permission insuffisante");
  }
}

const PERMISSION_NAMES: Partial<Record<keyof typeof PermissionFlagsBits, string>> = {
  BanMembers: "Bannir des membres",
  KickMembers: "Expulser des membres",
  ModerateMembers: "Exclure temporairement des membres",
  ManageMessages: "Gérer les messages",
  ManageChannels: "Gérer les salons",
  ManageRoles: "Gérer les rôles",
  ManageGuild: "Gérer le serveur",
  ViewAuditLog: "Voir les logs du serveur",
  SendMessages: "Envoyer des messages",
  EmbedLinks: "Intégrer des liens",
  AttachFiles: "Joindre des fichiers",
  ReadMessageHistory: "Voir l'historique des messages",
  ViewChannel: "Voir les salons",
  MentionEveryone: "Mentionner @everyone",
};

export function permissionNames(perms: PermissionResolvable): string[] {
  return new PermissionsBitField(perms).toArray().map((p) => PERMISSION_NAMES[p] ?? p);
}

/** Vérifie que le bot dispose des permissions requises (serveur ou salon). */
export function requireBotPermissions(me: GuildMember, perms: bigint[], channel?: GuildBasedChannel | null): void {
  const available = channel ? me.permissionsIn(channel) : me.permissions;
  const missing = available.missing(perms);
  if (missing.length > 0) {
    throw new UserError(
      `Il me manque les permissions suivantes${channel ? ` dans ${channel.toString()}` : ""} : ${missing.map((m) => `**${PERMISSION_NAMES[m] ?? m}**`).join(", ")}.`,
      "Permissions du bot insuffisantes",
    );
  }
}

/**
 * Vérifie qu'un modérateur peut sanctionner une cible : propriétaire, soi-même, le bot,
 * hiérarchie des rôles (acteur et bot).
 */
export function assertCanModerate(actor: GuildMember, targetId: string, target: GuildMember | null): void {
  const guild = actor.guild;
  const me = guild.members.me;
  if (!me) throw new UserError("Impossible de déterminer mes permissions sur ce serveur.");
  const error = checkHierarchy({
    actorId: actor.id,
    targetId,
    ownerId: guild.ownerId,
    botId: me.id,
    actorTopPosition: actor.roles.highest.position,
    targetTopPosition: target ? target.roles.highest.position : null,
    botTopPosition: me.roles.highest.position,
  });
  if (error) throw new UserError(HIERARCHY_MESSAGES[error], "Hiérarchie des rôles");
}
