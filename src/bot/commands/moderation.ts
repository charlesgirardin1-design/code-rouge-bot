import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type ButtonInteraction } from "discord.js";
import { PermissionLevel } from "../../permissions/levels.js";
import { assertCanModerate, requireBotPermissions } from "../permissions/index.js";
import { UserError } from "../errors.js";
import { formatDuration, MAX_TIMEOUT_MS, parseDuration } from "../../utils/duration.js";
import { truncate } from "../../utils/text.js";
import { infoEmbed } from "../ui/embeds.js";
import { actorOf, ok, reasonOf, reply, requireMember } from "./helpers.js";
import { warnExpiryCutoff } from "../../modules/moderation/escalation.js";
import type { SlashCommand } from "../types.js";

const DELETE_CHOICES = [
  { name: "Ne rien supprimer", value: 0 },
  { name: "Dernière heure", value: 3600 },
  { name: "Dernières 24 heures", value: 86400 },
  { name: "7 derniers jours", value: 604800 },
];

const ban: SlashCommand = {
  category: "Modération",
  level: PermissionLevel.MODERATOR,
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bannir un utilisateur du serveur")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName("utilisateur").setDescription("Utilisateur à bannir (membre ou ID)").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison du bannissement").setMaxLength(500))
    .addStringOption((o) => o.setName("duree").setDescription("Bannissement temporaire (ex. 7j, 12h). Vide = définitif"))
    .addIntegerOption((o) => o.setName("supprimer_messages").setDescription("Supprimer les messages récents").addChoices(...DELETE_CHOICES))
    .toJSON(),
  async execute(interaction, ctx) {
    const user = interaction.options.getUser("utilisateur", true);
    const member = interaction.options.getMember("utilisateur");
    const reason = reasonOf(interaction);
    const durationRaw = interaction.options.getString("duree");
    const durationMs = durationRaw ? parseDuration(durationRaw) : null;
    if (durationRaw && !durationMs) throw new UserError("Durée invalide. Exemples : `30m`, `12h`, `7j`.");
    const deleteMessageSeconds = interaction.options.getInteger("supprimer_messages") ?? 0;

    requireBotPermissions(interaction.guild.members.me!, [PermissionFlagsBits.BanMembers]);
    assertCanModerate(interaction.member, user.id, member);
    if (member && !member.bannable) throw new UserError("Je ne peux pas bannir ce membre (rôle trop élevé).");
    if (await interaction.guild.bans.fetch(user.id).catch(() => null)) throw new UserError("Cet utilisateur est déjà banni.");

    const run = async (target: ButtonInteraction<"cached"> | typeof interaction) => {
      const res = await ctx.moderation.ban({ guild: interaction.guild, actor: actorOf(interaction), user, reason, deleteMessageSeconds, durationMs });
      await reply(target, ok("Utilisateur banni", `${user.toString()} (\`${user.id}\`) a été banni${durationMs ? ` pour **${formatDuration(durationMs)}**` : ""}.\n**Raison :** ${reason ?? "Aucune"}\n**Cas :** #${res.caseNumber}${res.dmSent ? "" : "\n*MP non délivré.*"}`));
    };
    const config = await ctx.config.get(interaction.guildId);
    if (!config.moderation.confirmBan) {
      await interaction.deferReply({ flags: "Ephemeral" });
      return run(interaction);
    }
    await ctx.confirmations.prompt(interaction, {
      title: "Bannissement",
      description: `Vous êtes sur le point de bannir :\n**Utilisateur :** ${user.toString()} (\`${user.id}\`)\n**Raison :** ${reason ?? "Aucune"}\n**Durée :** ${durationMs ? formatDuration(durationMs) : "Définitive"}`,
      confirmLabel: "Confirmer",
      confirmEmoji: "🔨",
      onConfirm: run,
    });
  },
};

const unban: SlashCommand = {
  category: "Modération",
  level: PermissionLevel.MODERATOR,
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Lever le bannissement d'un utilisateur")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(0)
    .addStringOption((o) => o.setName("utilisateur_id").setDescription("ID de l'utilisateur banni").setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison").setMaxLength(500))
    .toJSON(),
  async execute(interaction, ctx) {
    const userId = interaction.options.getString("utilisateur_id", true).replace(/[<@!>]/g, "").trim();
    if (!/^\d{17,20}$/.test(userId)) throw new UserError("ID utilisateur invalide.");
    requireBotPermissions(interaction.guild.members.me!, [PermissionFlagsBits.BanMembers]);
    await interaction.deferReply({ flags: "Ephemeral" });
    const res = await ctx.moderation.unban({ guild: interaction.guild, actor: actorOf(interaction), userId, reason: reasonOf(interaction) });
    await reply(interaction, ok("Bannissement levé", `<@${userId}> (\`${userId}\`) peut de nouveau rejoindre le serveur.\n**Cas :** #${res.caseNumber}`));
  },
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const bans = await interaction.guild.bans.fetch({ limit: 1000 }).catch(() => null);
    const choices = [...(bans?.values() ?? [])]
      .filter((b) => b.user.id.includes(focused) || b.user.username.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((b) => ({ name: truncate(`${b.user.username} (${b.user.id})${b.reason ? ` — ${b.reason}` : ""}`, 100), value: b.user.id }));
    await interaction.respond(choices);
  },
};

const kick: SlashCommand = {
  category: "Modération",
  level: PermissionLevel.MODERATOR,
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulser un membre du serveur")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName("membre").setDescription("Membre à expulser").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison").setMaxLength(500))
    .toJSON(),
  async execute(interaction, ctx) {
    const member = requireMember(interaction);
    const reason = reasonOf(interaction);
    requireBotPermissions(interaction.guild.members.me!, [PermissionFlagsBits.KickMembers]);
    assertCanModerate(interaction.member, member.id, member);
    if (!member.kickable) throw new UserError("Je ne peux pas expulser ce membre (rôle trop élevé).");
    const run = async (target: ButtonInteraction<"cached"> | typeof interaction) => {
      const res = await ctx.moderation.kick({ guild: interaction.guild, actor: actorOf(interaction), member, reason });
      await reply(target, ok("Membre expulsé", `${member.user.tag} (\`${member.id}\`) a été expulsé.\n**Raison :** ${reason ?? "Aucune"}\n**Cas :** #${res.caseNumber}`));
    };
    const config = await ctx.config.get(interaction.guildId);
    if (!config.moderation.confirmKick) {
      await interaction.deferReply({ flags: "Ephemeral" });
      return run(interaction);
    }
    await ctx.confirmations.prompt(interaction, {
      title: "Expulsion",
      description: `Vous êtes sur le point d'expulser :\n**Membre :** ${member.toString()} (\`${member.id}\`)\n**Raison :** ${reason ?? "Aucune"}`,
      confirmEmoji: "👢",
      onConfirm: run,
    });
  },
};

const timeout: SlashCommand = {
  category: "Modération",
  level: PermissionLevel.MODERATOR,
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Exclure temporairement un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName("membre").setDescription("Membre à exclure").setRequired(true))
    .addStringOption((o) => o.setName("duree").setDescription("Durée (ex. 10m, 1h, 2j — max 28j)").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison").setMaxLength(500))
    .toJSON(),
  async execute(interaction, ctx) {
    const member = requireMember(interaction);
    const durationMs = parseDuration(interaction.options.getString("duree", true));
    if (!durationMs) throw new UserError("Durée invalide. Exemples : `10m`, `1h`, `2j`.");
    if (durationMs > MAX_TIMEOUT_MS) throw new UserError("La durée maximale est de 28 jours.");
    requireBotPermissions(interaction.guild.members.me!, [PermissionFlagsBits.ModerateMembers]);
    assertCanModerate(interaction.member, member.id, member);
    await interaction.deferReply({ flags: "Ephemeral" });
    const res = await ctx.moderation.timeout({ guild: interaction.guild, actor: actorOf(interaction), member, durationMs, reason: reasonOf(interaction) });
    await reply(interaction, ok("Membre exclu temporairement", `${member.toString()} est exclu pour **${formatDuration(durationMs)}**.\n**Cas :** #${res.caseNumber}`));
  },
};

const untimeout: SlashCommand = {
  category: "Modération",
  level: PermissionLevel.MODERATOR,
  data: new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Lever l'exclusion temporaire d'un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName("membre").setDescription("Membre").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison").setMaxLength(500))
    .toJSON(),
  async execute(interaction, ctx) {
    const member = requireMember(interaction);
    requireBotPermissions(interaction.guild.members.me!, [PermissionFlagsBits.ModerateMembers]);
    assertCanModerate(interaction.member, member.id, member);
    await interaction.deferReply({ flags: "Ephemeral" });
    const res = await ctx.moderation.untimeout({ guild: interaction.guild, actor: actorOf(interaction), member, reason: reasonOf(interaction) });
    await reply(interaction, ok("Exclusion levée", `${member.toString()} peut de nouveau participer.\n**Cas :** #${res.caseNumber}`));
  },
};

const warn: SlashCommand = {
  category: "Modération",
  level: PermissionLevel.MODERATOR,
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Avertir un membre (sanctions automatiques selon les paliers)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName("membre").setDescription("Membre à avertir").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison de l'avertissement").setRequired(true).setMaxLength(500))
    .toJSON(),
  async execute(interaction, ctx) {
    const member = requireMember(interaction);
    if (member.user.bot) throw new UserError("Impossible d'avertir un bot.");
    assertCanModerate(interaction.member, member.id, member);
    await interaction.deferReply({ flags: "Ephemeral" });
    const res = await ctx.moderation.warn({ guild: interaction.guild, actor: actorOf(interaction), member, reason: reasonOf(interaction, true)! });
    await reply(
      interaction,
      ok(
        "Avertissement enregistré",
        `${member.toString()} a reçu un avertissement (**${res.activeCount}** actif(s)).\n**Cas :** #${res.result.caseNumber}${res.escalation ? `\n**Sanction automatique :** ${res.escalation}` : ""}`,
      ),
    );
  },
};

const warnings: SlashCommand = {
  category: "Modération",
  level: PermissionLevel.SUPPORT,
  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Afficher les avertissements d'un membre")
    .setContexts(0)
    .addUserOption((o) => o.setName("utilisateur").setDescription("Utilisateur").setRequired(true))
    .toJSON(),
  async execute(interaction, ctx) {
    const user = interaction.options.getUser("utilisateur", true);
    const config = await ctx.config.get(interaction.guildId);
    const cutoff = warnExpiryCutoff(config.moderation);
    const list = await ctx.prisma.warning.findMany({ where: { guildId: interaction.guildId, userId: user.id }, orderBy: { createdAt: "desc" }, take: 25 });
    const isActive = (w: (typeof list)[number]) => w.active && (!cutoff || w.createdAt >= cutoff);
    const active = list.filter(isActive);
    const embed = infoEmbed(`Avertissements de ${user.username}`, list.length ? undefined : "Aucun avertissement.").setThumbnail(user.displayAvatarURL());
    if (list.length) {
      embed.setDescription(
        list
          .slice(0, 15)
          .map((w) => `${isActive(w) ? "🟡" : "⚪"} **#${w.id}** — ${truncate(w.reason, 120)}\n└ par <@${w.moderatorId}> · <t:${Math.floor(w.createdAt.getTime() / 1000)}:R>${isActive(w) ? "" : " · *inactif*"}`)
          .join("\n"),
      );
      embed.setFooter({ text: `${active.length} actif(s) · ${list.length} au total (25 max affichés)` });
    }
    await interaction.reply({ embeds: [embed], flags: "Ephemeral" });
  },
};

const clearwarnings: SlashCommand = {
  category: "Modération",
  level: PermissionLevel.MODERATOR,
  data: new SlashCommandBuilder()
    .setName("clearwarnings")
    .setDescription("Supprimer les avertissements d'un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addUserOption((o) => o.setName("utilisateur").setDescription("Utilisateur").setRequired(true))
    .addIntegerOption((o) => o.setName("avertissement").setDescription("ID d'un avertissement précis (sinon tous)").setMinValue(1))
    .addStringOption((o) => o.setName("raison").setDescription("Raison").setMaxLength(500))
    .toJSON(),
  async execute(interaction, ctx) {
    const user = interaction.options.getUser("utilisateur", true);
    const warningId = interaction.options.getInteger("avertissement");
    const reason = reasonOf(interaction);
    await ctx.confirmations.prompt(interaction, {
      title: "Suppression d'avertissements",
      description: `Supprimer ${warningId ? `l'avertissement **#${warningId}**` : "**tous** les avertissements actifs"} de ${user.toString()} ?`,
      confirmEmoji: "🧹",
      onConfirm: async (button) => {
        const count = await ctx.moderation.clearWarnings({ guild: interaction.guild, actor: actorOf(interaction), userId: user.id, userTag: user.tag, warningId, reason });
        await reply(button, ok("Avertissements supprimés", `${count} avertissement(s) de ${user.toString()} désactivé(s).`));
      },
    });
  },
};

const clear: SlashCommand = {
  category: "Modération",
  level: PermissionLevel.MODERATOR,
  cooldownSeconds: 5,
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Supprimer des messages récents dans ce salon")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(0)
    .addIntegerOption((o) => o.setName("nombre").setDescription("Nombre de messages à analyser (1-100)").setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName("membre").setDescription("Ne supprimer que les messages de ce membre"))
    .toJSON(),
  async execute(interaction, ctx) {
    const channel = interaction.channel;
    if (!channel || !("bulkDelete" in channel)) throw new UserError("Cette commande doit être utilisée dans un salon textuel.");
    requireBotPermissions(interaction.guild.members.me!, [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory], channel);
    const amount = interaction.options.getInteger("nombre", true);
    const target = interaction.options.getUser("membre");
    await interaction.deferReply({ flags: "Ephemeral" });
    let deleted = 0;
    const res = await ctx.moderation.recordSimple({
      guild: interaction.guild,
      type: "CLEAR_MESSAGES",
      actor: actorOf(interaction),
      target: target ? { id: target.id, tag: target.tag } : { id: channel.id, tag: `#${channel.name}` },
      reason: null,
      metadata: { Salon: `<#${channel.id}>`, Demandé: amount },
      run: async () => {
        const fetched = await channel.messages.fetch({ limit: amount });
        const toDelete = target ? fetched.filter((m) => m.author.id === target.id) : fetched;
        const result = await channel.bulkDelete(toDelete, true);
        deleted = result.size;
      },
    });
    ctx.stats.increment(interaction.guildId, "messagesDeleted", deleted);
    await reply(interaction, ok("Messages supprimés", `${deleted} message(s) supprimé(s)${target ? ` de ${target.toString()}` : ""}.${deleted < amount ? "\n*Les messages de plus de 14 jours ne peuvent pas être supprimés en masse.*" : ""}\n**Cas :** #${res.caseNumber}`));
  },
};

const slowmode: SlashCommand = {
  category: "Modération",
  level: PermissionLevel.MODERATOR,
  data: new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Définir le mode lent d'un salon")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(0)
    .addIntegerOption((o) => o.setName("secondes").setDescription("Délai entre deux messages (0 pour désactiver, max 21600)").setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption((o) => o.setName("salon").setDescription("Salon (par défaut : salon actuel)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum))
    .addStringOption((o) => o.setName("raison").setDescription("Raison").setMaxLength(500))
    .toJSON(),
  async execute(interaction, ctx) {
    const channel = interaction.options.getChannel("salon") ?? interaction.channel;
    if (!channel || !("setRateLimitPerUser" in channel)) throw new UserError("Ce salon ne prend pas en charge le mode lent.");
    requireBotPermissions(interaction.guild.members.me!, [PermissionFlagsBits.ManageChannels], channel);
    const seconds = interaction.options.getInteger("secondes", true);
    await interaction.deferReply({ flags: "Ephemeral" });
    const res = await ctx.moderation.recordSimple({
      guild: interaction.guild,
      type: "SLOWMODE",
      actor: actorOf(interaction),
      target: { id: channel.id, tag: `#${channel.name}` },
      reason: reasonOf(interaction),
      metadata: { Salon: `<#${channel.id}>`, Délai: seconds ? formatDuration(seconds * 1000) : "désactivé" },
      run: () => channel.setRateLimitPerUser(seconds, reasonOf(interaction) ?? undefined),
    });
    await reply(interaction, ok("Mode lent mis à jour", `${seconds ? `Mode lent de **${formatDuration(seconds * 1000)}**` : "Mode lent désactivé"} dans <#${channel.id}>.\n**Cas :** #${res.caseNumber}`));
  },
};

export const moderationCommands: SlashCommand[] = [ban, unban, kick, timeout, untimeout, warn, warnings, clearwarnings, clear, slowmode];
