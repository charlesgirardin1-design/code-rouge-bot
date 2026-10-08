/**
 * Niveaux de permission du bot. Logique pure partagée entre le bot et l'API du dashboard :
 * le niveau est TOUJOURS calculé côté serveur à partir des données Discord.
 */
export enum PermissionLevel {
  MEMBER = 0,
  SUPPORT = 1,
  MODERATOR = 2,
  ADMIN = 3,
  OWNER = 4,
}

export const PERMISSION_LEVEL_NAMES: Record<PermissionLevel, string> = {
  [PermissionLevel.MEMBER]: "Membre",
  [PermissionLevel.SUPPORT]: "Support",
  [PermissionLevel.MODERATOR]: "Modérateur",
  [PermissionLevel.ADMIN]: "Administrateur",
  [PermissionLevel.OWNER]: "Propriétaire",
};

/** Bits de permission Discord utilisés (identiques à PermissionFlagsBits de discord.js). */
export const DiscordPerm = {
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  ViewAuditLog: 1n << 7n,
  ManageMessages: 1n << 13n,
  MentionEveryone: 1n << 17n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  ManageGuildExpressions: 1n << 30n,
  ModerateMembers: 1n << 40n,
} as const;

/** Permissions jugées dangereuses (utilisées par l'anti-bot et l'anti-nuke). */
export const DANGEROUS_PERMISSIONS =
  DiscordPerm.Administrator |
  DiscordPerm.ManageGuild |
  DiscordPerm.ManageRoles |
  DiscordPerm.ManageChannels |
  DiscordPerm.BanMembers |
  DiscordPerm.KickMembers |
  DiscordPerm.ManageWebhooks;

export interface PermissionContext {
  userId: string;
  ownerId: string;
  /** Permissions Discord effectives du membre sur le serveur */
  permissions: bigint;
  roleIds: readonly string[];
  config: {
    adminRoleIds: readonly string[];
    moderatorRoleIds: readonly string[];
    supportRoleIds: readonly string[];
  };
}

const hasAny = (roles: readonly string[], wanted: readonly string[]) => wanted.some((r) => roles.includes(r));

export function computePermissionLevel(ctx: PermissionContext): PermissionLevel {
  if (ctx.userId === ctx.ownerId) return PermissionLevel.OWNER;
  const p = ctx.permissions;
  if ((p & DiscordPerm.Administrator) !== 0n || (p & DiscordPerm.ManageGuild) !== 0n || hasAny(ctx.roleIds, ctx.config.adminRoleIds)) {
    return PermissionLevel.ADMIN;
  }
  if (
    (p & (DiscordPerm.BanMembers | DiscordPerm.KickMembers | DiscordPerm.ModerateMembers)) !== 0n ||
    hasAny(ctx.roleIds, ctx.config.moderatorRoleIds)
  ) {
    return PermissionLevel.MODERATOR;
  }
  if (hasAny(ctx.roleIds, ctx.config.supportRoleIds)) return PermissionLevel.SUPPORT;
  return PermissionLevel.MEMBER;
}

/** Calcule les permissions de serveur d'un membre à partir des rôles (comme le fait Discord). */
export function computeGuildPermissions(
  memberRoleIds: readonly string[],
  roles: ReadonlyArray<{ id: string; permissions: string | bigint }>,
  guildId: string,
): bigint {
  let perms = 0n;
  for (const role of roles) {
    if (role.id === guildId || memberRoleIds.includes(role.id)) perms |= BigInt(role.permissions);
  }
  return perms;
}

export interface HierarchyInput {
  actorId: string;
  targetId: string;
  ownerId: string;
  botId: string;
  /** Position du rôle le plus élevé ; null si la cible n'est pas membre du serveur */
  actorTopPosition: number;
  targetTopPosition: number | null;
  botTopPosition: number;
}

export type HierarchyError = "TARGET_IS_SELF" | "TARGET_IS_OWNER" | "TARGET_IS_BOT" | "TARGET_HIGHER_THAN_ACTOR" | "TARGET_HIGHER_THAN_BOT";

export const HIERARCHY_MESSAGES: Record<HierarchyError, string> = {
  TARGET_IS_SELF: "Vous ne pouvez pas vous sanctionner vous-même.",
  TARGET_IS_OWNER: "Impossible de sanctionner le propriétaire du serveur.",
  TARGET_IS_BOT: "Je ne peux pas me sanctionner moi-même.",
  TARGET_HIGHER_THAN_ACTOR: "Ce membre a un rôle supérieur ou égal au vôtre.",
  TARGET_HIGHER_THAN_BOT: "Ce membre a un rôle supérieur ou égal au mien : Discord m'interdit d'agir.",
};

/** Vérifie la hiérarchie des rôles Discord avant une sanction. */
export function checkHierarchy(i: HierarchyInput): HierarchyError | null {
  if (i.targetId === i.actorId) return "TARGET_IS_SELF";
  if (i.targetId === i.ownerId) return "TARGET_IS_OWNER";
  if (i.targetId === i.botId) return "TARGET_IS_BOT";
  if (i.targetTopPosition === null) return null; // Utilisateur hors serveur (ex. ban par ID)
  if (i.actorId !== i.ownerId && i.targetTopPosition >= i.actorTopPosition) return "TARGET_HIGHER_THAN_ACTOR";
  if (i.targetTopPosition >= i.botTopPosition) return "TARGET_HIGHER_THAN_BOT";
  return null;
}
