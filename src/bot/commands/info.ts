import { ChannelType, EmbedBuilder, GuildVerificationLevel, SlashCommandBuilder, type Guild } from "discord.js";
import { PermissionLevel, PERMISSION_LEVEL_NAMES } from "../../permissions/levels.js";
import { memberLevel } from "../permissions/index.js";
import { Colors, discordDate } from "../ui/embeds.js";
import { LEVEL_EMOJIS, LEVEL_LABELS } from "../../modules/security/riskEngine.js";
import type { BotContext, CommandCategory, SlashCommand } from "../types.js";

const VERIFICATION_LABELS: Record<GuildVerificationLevel, string> = {
  [GuildVerificationLevel.None]: "Aucun",
  [GuildVerificationLevel.Low]: "Faible",
  [GuildVerificationLevel.Medium]: "Moyen",
  [GuildVerificationLevel.High]: "Élevé",
  [GuildVerificationLevel.VeryHigh]: "Très élevé",
};

function memberCounts(guild: Guild) {
  const cached = guild.members.cache;
  const bots = cached.filter((m) => m.user.bot).size;
  const online = cached.filter((m) => m.presence && m.presence.status !== "offline").size;
  return { total: guild.memberCount, bots, humans: guild.memberCount - bots, online, presenceAvailable: guild.client.options.intents.has("GuildPresences") };
}

const server: SlashCommand = {
  category: "Informations",
  level: PermissionLevel.MEMBER,
  data: new SlashCommandBuilder().setName("server").setDescription("Informations sur le serveur").setContexts(0).toJSON(),
  async execute(interaction) {
    const g = interaction.guild;
    const counts = memberCounts(g);
    const channels = g.channels.cache;
    const embed = new EmbedBuilder()
      .setColor(Colors.info)
      .setTitle(`🔵 ${g.name}`)
      .setThumbnail(g.iconURL({ size: 256 }))
      .addFields(
        { name: "Propriétaire", value: `<@${g.ownerId}>`, inline: true },
        { name: "Créé le", value: discordDate(g.createdAt), inline: true },
        { name: "ID", value: `\`${g.id}\``, inline: true },
        { name: "Membres", value: `${counts.total} (dont ${counts.bots} bots)`, inline: true },
        { name: "En ligne", value: counts.presenceAvailable ? String(counts.online) : "Non disponible (intent Presence désactivé)", inline: true },
        { name: "Rôles", value: String(g.roles.cache.size - 1), inline: true },
        { name: "Salons", value: `${channels.filter((c) => c.type === ChannelType.GuildText).size} textuels · ${channels.filter((c) => c.type === ChannelType.GuildVoice).size} vocaux`, inline: true },
        { name: "Boosts", value: `${g.premiumSubscriptionCount ?? 0} (niveau ${g.premiumTier})`, inline: true },
        { name: "Vérification Discord", value: VERIFICATION_LABELS[g.verificationLevel], inline: true },
      );
    await interaction.reply({ embeds: [embed] });
  },
};

const stats: SlashCommand = {
  category: "Informations",
  level: PermissionLevel.SUPPORT,
  data: new SlashCommandBuilder().setName("stats").setDescription("Statistiques de modération et de sécurité").setContexts(0).toJSON(),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    await interaction.deferReply({ flags: "Ephemeral" });
    const [stored, sanctions, warnings, openTickets, totalTickets] = await Promise.all([
      ctx.prisma.guildStatistics.findUnique({ where: { guildId } }),
      ctx.prisma.moderationAction.groupBy({ by: ["type"], where: { guildId, success: true }, _count: true }),
      ctx.prisma.warning.count({ where: { guildId, active: true } }),
      ctx.prisma.ticket.count({ where: { guildId, status: { in: ["OPEN", "CLAIMED"] } } }),
      ctx.prisma.ticket.count({ where: { guildId } }),
    ]);
    const pending = ctx.stats.pending(guildId);
    const stat = (k: keyof typeof pending) => (stored?.[k] ?? 0) + (pending[k] ?? 0);
    const sanction = (t: string) => sanctions.find((s) => s.type === t)?._count ?? 0;
    const counts = memberCounts(interaction.guild);
    const { score, level } = ctx.security.risk.peek(guildId);
    const embed = new EmbedBuilder()
      .setColor(Colors.info)
      .setTitle("📊 Statistiques")
      .addFields(
        { name: "Membres", value: `${counts.total} · ${counts.humans} humains · ${counts.bots} bots${counts.presenceAvailable ? ` · ${counts.online} en ligne` : ""}` },
        { name: "Sanctions", value: `🔨 ${sanction("BAN")} bans · 👢 ${sanction("KICK")} kicks · ⏳ ${sanction("TIMEOUT")} timeouts · ⚠️ ${sanction("WARN")} warns (${warnings} actifs)` },
        { name: "Messages supprimés", value: String(stat("messagesDeleted")), inline: true },
        { name: "Spams détectés", value: String(stat("spamDetected")), inline: true },
        { name: "Raids détectés", value: String(stat("raidsDetected")), inline: true },
        { name: "Liens bloqués", value: String(stat("linksBlocked")), inline: true },
        { name: "Attaques nuke", value: String(stat("nukeDetected")), inline: true },
        { name: "Membres vérifiés", value: String(stat("membersVerified")), inline: true },
        { name: "Tickets", value: `${openTickets} ouvert(s) · ${totalTickets} au total`, inline: true },
        { name: "Sécurité", value: `${LEVEL_EMOJIS[level]} ${LEVEL_LABELS[level]} (score ${score})`, inline: true },
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};

export function createHelpCommand(getCommands: () => SlashCommand[]): SlashCommand {
  return {
    category: "Informations",
    level: PermissionLevel.MEMBER,
    data: new SlashCommandBuilder().setName("help").setDescription("Liste des commandes disponibles pour vous").setContexts(0).toJSON(),
    async execute(interaction, ctx: BotContext) {
      const config = await ctx.config.get(interaction.guildId);
      const level = memberLevel(interaction.member, config);
      const minLevel = (c: SlashCommand): PermissionLevel => (typeof c.level === "number" ? c.level : PermissionLevel.MEMBER);
      const byCategory = new Map<CommandCategory, string[]>();
      for (const cmd of getCommands()) {
        if (minLevel(cmd) > level) continue;
        const subs = (cmd.data.options ?? []).filter((o) => o.type === 1).map((o) => `\`/${cmd.data.name} ${o.name}\` — ${o.description}`);
        const lines = subs.length ? subs : [`\`/${cmd.data.name}\` — ${cmd.data.description}`];
        byCategory.set(cmd.category, [...(byCategory.get(cmd.category) ?? []), ...lines]);
      }
      const embed = new EmbedBuilder().setColor(Colors.info).setTitle("🔵 Aide — Code Rouge").setDescription(`Votre niveau : **${PERMISSION_LEVEL_NAMES[level]}**`);
      for (const [cat, lines] of byCategory) embed.addFields({ name: cat, value: lines.join("\n").slice(0, 1024) });
      await interaction.reply({ embeds: [embed], flags: "Ephemeral" });
    },
  };
}

export const infoCommands: SlashCommand[] = [server, stats];
