import { EmbedBuilder, type AttachmentBuilder, type Client, type Guild } from "discord.js";
import type { GuildConfig } from "../../config/guildConfig.js";
import type { GuildConfigService } from "../../services/guildConfigService.js";
import { Colors, discordDate } from "../../bot/ui/embeds.js";
import { childLogger } from "../../utils/logger.js";
import { truncate } from "../../utils/text.js";

const log = childLogger("logs");

export type LogCategory = "moderation" | "members" | "security" | "server" | "tickets";

const CHANNEL_KEYS: Record<LogCategory, keyof GuildConfig["logs"]> = {
  moderation: "moderationChannelId",
  members: "membersChannelId",
  security: "securityChannelId",
  server: "serverChannelId",
  tickets: "ticketsChannelId",
};

export interface LogPayload {
  embeds: EmbedBuilder[];
  files?: AttachmentBuilder[];
  /** Mentionne les rôles d'alerte configurés (alertes de sécurité critiques) */
  alert?: boolean;
}

export interface AuditEmbedInput {
  action: string;
  actor: string;
  target?: string | null;
  reason?: string | null;
  result: "Succès" | "Échec" | string;
  date?: Date;
  color?: number;
  extra?: Array<{ name: string; value: string; inline?: boolean }>;
}

/** Embed de traçabilité normalisé : QUI ? QUOI ? QUAND ? SUR QUI ? POURQUOI ? QUEL RÉSULTAT ? */
export function auditEmbed(input: AuditEmbedInput): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(input.color ?? (input.result === "Échec" ? Colors.error : Colors.info))
    .setTitle(input.action)
    .addFields(
      { name: "Qui", value: truncate(input.actor, 1024), inline: true },
      { name: "Sur qui", value: truncate(input.target ?? "—", 1024), inline: true },
      { name: "Quand", value: discordDate(input.date ?? new Date()), inline: true },
      { name: "Pourquoi", value: truncate(input.reason || "Aucune raison fournie", 1024) },
      { name: "Résultat", value: truncate(input.result, 1024), inline: true },
    )
    .setTimestamp(input.date ?? new Date());
  for (const field of input.extra ?? []) embed.addFields({ name: field.name, value: truncate(field.value || "—", 1024), inline: field.inline ?? false });
  return embed;
}

export class LogService {
  constructor(private readonly client: Client, private readonly configs: GuildConfigService) {}

  async send(guild: Guild, category: LogCategory, payload: LogPayload): Promise<void> {
    try {
      const config = await this.configs.get(guild.id);
      const channelId = config.logs[CHANNEL_KEYS[category]];
      if (typeof channelId !== "string") return;
      const channel = guild.channels.cache.get(channelId);
      if (!channel?.isTextBased() || !guild.members.me) return;
      const perms = guild.members.me.permissionsIn(channel);
      if (!perms.has(["ViewChannel", "SendMessages", "EmbedLinks"])) {
        log.warn({ guildId: guild.id, category }, "Salon de logs inaccessible (permissions manquantes)");
        return;
      }
      const alertRoles = payload.alert ? config.logs.alertRoleIds : [];
      await channel.send({
        content: alertRoles.length ? alertRoles.map((r) => `<@&${r}>`).join(" ") : undefined,
        embeds: payload.embeds.slice(0, 10),
        files: payload.files,
        allowedMentions: { roles: alertRoles, users: [], parse: [] },
      });
    } catch (err) {
      log.warn({ err, guildId: guild.id, category }, "Impossible d'envoyer un log");
    }
  }

  /** Alerte critique : salon sécurité (+ rôles d'alerte) et MP au propriétaire si configuré. */
  async alert(guild: Guild, embed: EmbedBuilder): Promise<void> {
    await this.send(guild, "security", { embeds: [embed], alert: true });
    const config = await this.configs.get(guild.id);
    if (!config.logs.dmOwnerOnCritical) return;
    try {
      const owner = await guild.fetchOwner();
      await owner.send({ content: `🚨 Alerte de sécurité sur **${guild.name}**`, embeds: [embed] });
    } catch {
      // MP fermés : l'alerte reste disponible dans le salon de sécurité.
    }
  }
}
