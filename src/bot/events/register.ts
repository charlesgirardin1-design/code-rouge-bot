import { Events, type Client, type Guild, type GuildMember, type PartialGuildMember } from "discord.js";
import { auditEmbed } from "../../modules/logs/logService.js";
import { Colors, discordDate } from "../ui/embeds.js";
import { formatDuration } from "../../utils/duration.js";
import { childLogger } from "../../utils/logger.js";
import { createInteractionRouter } from "../interactions/router.js";
import { logAuditEntry } from "./auditLogger.js";
import type { BotContext } from "../types.js";

const log = childLogger("events");

/** Enveloppe chaque gestionnaire : une erreur ne doit jamais faire tomber le bot. */
function safe<A extends unknown[]>(name: string, fn: (...args: A) => Promise<void>) {
  return (...args: A) => {
    fn(...args).catch((err: unknown) => log.error({ err, event: name }, "Erreur dans un gestionnaire d'événement"));
  };
}

async function syncGuild(guild: Guild, ctx: BotContext): Promise<void> {
  await ctx.config.ensureGuild({ id: guild.id, name: guild.name, ownerId: guild.ownerId, iconHash: guild.icon });
}

export function registerEvents(client: Client<true>, ctx: BotContext): void {
  const handleInteraction = createInteractionRouter(ctx);
  client.on(Events.InteractionCreate, safe("interactionCreate", handleInteraction));

  client.on(Events.GuildCreate, safe("guildCreate", async (guild) => {
    log.info({ guildId: guild.id, name: guild.name }, "Ajouté à un serveur");
    await syncGuild(guild, ctx);
  }));

  client.on(Events.GuildDelete, safe("guildDelete", async (guild) => {
    log.info({ guildId: guild.id }, "Retiré d'un serveur");
    await ctx.prisma.guild.updateMany({ where: { id: guild.id }, data: { leftAt: new Date() } });
  }));

  client.on(Events.GuildUpdate, safe("guildUpdate", async (_old, guild) => syncGuild(guild, ctx)));

  // ─── Membres ──────────────────────────────────────────────

  client.on(Events.GuildMemberAdd, safe("guildMemberAdd", async (member: GuildMember) => {
    const outcome = await ctx.security.handleMemberJoin(member);
    if (!outcome.restricted) await ctx.verification.onJoin(member);
    await ctx.welcome.onJoin(member);
    const ageMs = Date.now() - member.user.createdTimestamp;
    await ctx.logs.send(member.guild, "members", {
      embeds: [
        auditEmbed({
          action: member.user.bot ? "🤖 Bot ajouté" : "📥 Arrivée d'un membre",
          actor: `${member.toString()} (${member.user.tag})`,
          target: `\`${member.id}\``,
          reason: null,
          result: outcome.restricted ? "Accès limité (sécurité)" : "Accès normal",
          color: Colors.success,
          extra: [
            { name: "Compte créé", value: `${discordDate(member.user.createdAt)}${ageMs < 7 * 86_400_000 ? " ⚠️ récent" : ""}`, inline: true },
            { name: "Membres", value: String(member.guild.memberCount), inline: true },
          ],
        }).setThumbnail(member.user.displayAvatarURL()),
      ],
    });
  }));

  client.on(Events.GuildMemberRemove, safe("guildMemberRemove", async (member: GuildMember | PartialGuildMember) => {
    await ctx.prisma.memberProfile.updateMany({ where: { guildId: member.guild.id, userId: member.id }, data: { leftAt: new Date() } });
    const stayed = member.joinedTimestamp ? formatDuration(Date.now() - member.joinedTimestamp) : "inconnue";
    const roles = member.partial ? [] : member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => r.name);
    await ctx.logs.send(member.guild, "members", {
      embeds: [
        auditEmbed({
          action: "📤 Départ d'un membre",
          actor: `<@${member.id}> (${member.user?.tag ?? "?"})`,
          target: `\`${member.id}\``,
          result: "—",
          color: Colors.neutral,
          extra: [
            { name: "Présence", value: stayed, inline: true },
            { name: "Rôles", value: roles.join(", ").slice(0, 1000) || "Aucun", inline: true },
          ],
        }),
      ],
    });
  }));

  // ─── Messages ─────────────────────────────────────────────

  client.on(Events.MessageCreate, safe("messageCreate", async (message) => {
    if (!message.inGuild() || message.author.bot) return;
    await ctx.security.handleMessage(message);
  }));

  // ─── Journal d'audit : anti-nuke + logs serveur ───────────

  client.on(Events.GuildAuditLogEntryCreate, safe("guildAuditLogEntryCreate", async (entry, guild) => {
    await ctx.security.handleAuditLogEntry(entry, guild);
    await logAuditEntry(entry, guild, ctx);
  }));

  client.on(Events.ChannelDelete, safe("channelDelete", async (channel) => {
    if ("guild" in channel && channel.guild) await ctx.tickets.onChannelDelete(channel.guild, channel.id);
  }));

  client.on(Events.Error, (err) => log.error({ err }, "Erreur du client Discord"));
  client.on(Events.Warn, (msg) => log.warn(msg));
  client.on(Events.ShardDisconnect, (_e, shard) => log.warn({ shard }, "Shard déconnecté"));
  client.on(Events.ShardResume, (shard) => log.info({ shard }, "Shard reconnecté"));
}

export async function syncAllGuilds(client: Client<true>, ctx: BotContext): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      await syncGuild(guild, ctx);
    } catch (err) {
      log.error({ err, guildId: guild.id }, "Synchronisation du serveur impossible");
    }
  }
}
