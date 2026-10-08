import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { PermissionLevel } from "../../permissions/levels.js";
import {
  buildPatch,
  changedOwnerOnlyPaths,
  coerceConfigValue,
  deepMerge,
  defaultGuildConfig,
  getByPath,
  guildConfigSchema,
  listConfigLeaves,
  validatedGuildConfigSchema,
  type GuildConfig,
} from "../../config/guildConfig.js";
import { UserError } from "../errors.js";
import { infoEmbed } from "../ui/embeds.js";
import { memberLevel } from "../permissions/index.js";
import { actorOf, ok, reply } from "./helpers.js";
import { requireBotPermissions } from "../permissions/index.js";
import { announcementInputSchema, buildAnnouncementMessage } from "../../modules/announcements/announcementService.js";
import { parseScheduleDate } from "../../utils/duration.js";
import { truncate } from "../../utils/text.js";
import type { SlashCommand } from "../types.js";

const SECTIONS = Object.keys(guildConfigSchema.shape) as (keyof GuildConfig)[];
const LEAVES = listConfigLeaves();

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "*non défini*";
  if (Array.isArray(value)) return value.length ? value.map((v) => (typeof v === "string" && /^\d{17,20}$/.test(v) ? `\`${v}\`` : JSON.stringify(v))).join(", ") : "*vide*";
  if (typeof value === "object") return `\`${truncate(JSON.stringify(value), 200)}\``;
  return `\`${String(value)}\``;
}

const config: SlashCommand = {
  category: "Administration",
  level: PermissionLevel.ADMIN,
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configuration du bot pour ce serveur")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName("view")
        .setDescription("Afficher la configuration")
        .addStringOption((o) => o.setName("section").setDescription("Section à afficher").addChoices(...SECTIONS.map((k) => ({ name: k, value: k })))),
    )
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Modifier une valeur (salons/rôles : mention ou ID ; listes : séparées par des virgules)")
        .addStringOption((o) => o.setName("cle").setDescription("Clé de configuration").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("valeur").setDescription("Nouvelle valeur (« none » pour vider)").setRequired(true).setMaxLength(3000)),
    )
    .addSubcommand((s) =>
      s
        .setName("reset")
        .setDescription("Réinitialiser une section aux valeurs par défaut")
        .addStringOption((o) => o.setName("section").setDescription("Section").setRequired(true).addChoices(...SECTIONS.map((k) => ({ name: k, value: k })))),
    )
    .addSubcommand((s) => s.setName("export").setDescription("Exporter la configuration en JSON"))
    .addSubcommand((s) =>
      s
        .setName("import")
        .setDescription("Importer une configuration JSON (remplace la configuration actuelle)")
        .addAttachmentOption((o) => o.setName("fichier").setDescription("Fichier .json exporté").setRequired(true)),
    )
    .toJSON(),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      LEAVES.filter((l) => l.path.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((l) => ({ name: truncate(`${l.path} (${l.kind}${l.options ? `: ${l.options.join("/")}` : ""})`, 100), value: l.path })),
    );
  },
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const current = await ctx.config.get(guildId);
    const isOwner = memberLevel(interaction.member, current) >= PermissionLevel.OWNER;
    const assertOwnerOnly = (next: unknown) => {
      const sensitive = changedOwnerOnlyPaths(current, next);
      if (sensitive.length && !isOwner) throw new UserError(`Seul le propriétaire du serveur peut modifier : ${sensitive.join(", ")}.`, "Permission insuffisante");
    };

    if (sub === "view") {
      const section = interaction.options.getString("section") as keyof GuildConfig | null;
      if (!section) {
        const embed = infoEmbed("Configuration du serveur", "Utilisez `/config view section:<nom>` pour le détail, `/config set` pour modifier, ou le dashboard.").addFields(
          SECTIONS.map((s) => {
            const value = current[s] as Record<string, unknown>;
            return { name: s, value: "enabled" in value ? (value["enabled"] ? "🟢 activé" : "⚫ désactivé") : `${Object.keys(value).length} paramètre(s)`, inline: true };
          }),
        );
        await interaction.reply({ embeds: [embed], flags: "Ephemeral" });
        return;
      }
      const lines = LEAVES.filter((l) => l.path.startsWith(`${section}.`)).map((l) => `**${l.path.slice(section.length + 1)}** : ${formatValue(getByPath(current, l.path))}`);
      await interaction.reply({ embeds: [infoEmbed(`Configuration — ${section}`, truncate(lines.join("\n"), 4000))], flags: "Ephemeral" });
      return;
    }

    if (sub === "set") {
      const key = interaction.options.getString("cle", true);
      const leaf = LEAVES.find((l) => l.path === key);
      if (!leaf) throw new UserError("Clé de configuration inconnue. Utilisez l'autocomplétion.");
      const coerced = coerceConfigValue(leaf, interaction.options.getString("valeur", true));
      if (!coerced.ok) throw new UserError(coerced.error, "Valeur invalide");
      const before = getByPath(current, key);
      assertOwnerOnly(deepMerge(current, buildPatch(key, coerced.value)));
      const result = await ctx.config.update(guildId, buildPatch(key, coerced.value), interaction.user.id);
      if (!result.ok) throw new UserError(result.errors.join("\n"), "Configuration refusée");
      await ctx.audit.record({ guildId, actorId: interaction.user.id, actorType: "USER", action: "config.update", targetId: key, targetType: "config", details: { before, after: coerced.value } });
      await interaction.reply({ embeds: [ok("Configuration mise à jour", `**${key}**\n${formatValue(before)} → ${formatValue(coerced.value)}`)], flags: "Ephemeral" });
      return;
    }

    if (sub === "reset") {
      const section = interaction.options.getString("section", true) as keyof GuildConfig;
      await ctx.confirmations.prompt(interaction, {
        title: "Réinitialisation",
        description: `La section **${section}** sera remise à ses valeurs par défaut.`,
        onConfirm: async (button) => {
          const fresh = { ...(await ctx.config.get(guildId)), [section]: defaultGuildConfig()[section] } as GuildConfig;
          assertOwnerOnly(fresh);
          const parsed = validatedGuildConfigSchema.safeParse(fresh);
          if (!parsed.success) throw new UserError(parsed.error.issues.map((i) => i.message).join("\n"));
          await ctx.config.replace(guildId, parsed.data, interaction.user.id);
          await ctx.audit.record({ guildId, actorId: interaction.user.id, actorType: "USER", action: "config.reset", targetId: section, targetType: "config" });
          await reply(button, ok("Section réinitialisée", `**${section}** utilise de nouveau les valeurs par défaut.`));
        },
      });
      return;
    }

    if (sub === "export") {
      const file = new AttachmentBuilder(Buffer.from(JSON.stringify(current, null, 2), "utf8"), { name: `config-${guildId}.json` });
      await interaction.reply({ embeds: [infoEmbed("Export de la configuration")], files: [file], flags: "Ephemeral" });
      return;
    }

    // import
    const attachment = interaction.options.getAttachment("fichier", true);
    if (attachment.size > 100_000) throw new UserError("Fichier trop volumineux (100 Ko max).");
    if (!attachment.name.endsWith(".json")) throw new UserError("Le fichier doit être au format .json.");
    await interaction.deferReply({ flags: "Ephemeral" });
    const response = await fetch(attachment.url);
    if (!response.ok) throw new UserError("Impossible de télécharger le fichier.");
    let raw: unknown;
    try {
      raw = JSON.parse(await response.text());
    } catch {
      throw new UserError("Le fichier n'est pas un JSON valide.");
    }
    const parsed = validatedGuildConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UserError(parsed.error.issues.slice(0, 10).map((i) => `• ${i.path.join(".")} : ${i.message}`).join("\n"), "Configuration invalide");
    }
    assertOwnerOnly(parsed.data);
    await ctx.confirmations.prompt(interaction, {
      title: "Import de configuration",
      description: "La configuration actuelle sera **entièrement remplacée** par le fichier importé (validé).",
      onConfirm: async (button) => {
        await ctx.config.replace(guildId, parsed.data, interaction.user.id);
        await ctx.audit.record({ guildId, actorId: interaction.user.id, actorType: "USER", action: "config.import", targetType: "config" });
        await reply(button, ok("Configuration importée"));
      },
    });
  },
};

const announce: SlashCommand = {
  category: "Administration",
  level: PermissionLevel.ADMIN,
  data: new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Créer une annonce (aperçu avant publication)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addChannelOption((o) => o.setName("salon").setDescription("Salon de publication").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption((o) => o.setName("description").setDescription("Texte de l'annonce (\\n pour un retour à la ligne)").setRequired(true).setMaxLength(4000))
    .addStringOption((o) => o.setName("titre").setDescription("Titre").setMaxLength(256))
    .addStringOption((o) => o.setName("couleur").setDescription("Couleur hexadécimale (ex. #3B82F6)").setMaxLength(7))
    .addStringOption((o) => o.setName("image").setDescription("URL d'image (https)"))
    .addStringOption((o) => o.setName("miniature").setDescription("URL de miniature (https)"))
    .addStringOption((o) => o.setName("footer").setDescription("Pied de page").setMaxLength(2048))
    .addStringOption((o) => o.setName("auteur").setDescription("Auteur affiché").setMaxLength(256))
    .addStringOption((o) => o.setName("mention").setDescription("Mention").addChoices({ name: "@everyone", value: "everyone" }, { name: "@here", value: "here" }))
    .addRoleOption((o) => o.setName("role").setDescription("Rôle à mentionner"))
    .addStringOption((o) => o.setName("bouton_texte").setDescription("Texte du bouton lien").setMaxLength(80))
    .addStringOption((o) => o.setName("bouton_url").setDescription("URL du bouton (https)"))
    .addStringOption((o) => o.setName("programmer").setDescription("Publier plus tard : « 2026-10-09 18:30 », « 09/10/2026 18:30 » ou « 2h »"))
    .toJSON(),
  async execute(interaction, ctx) {
    const channel = interaction.options.getChannel("salon", true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
    const role = interaction.options.getRole("role");
    const mention = interaction.options.getString("mention") ?? role?.id ?? null;
    const parsed = announcementInputSchema.safeParse({
      channelId: channel.id,
      title: interaction.options.getString("titre"),
      description: interaction.options.getString("description", true).replace(/\\n/g, "\n"),
      color: interaction.options.getString("couleur"),
      imageUrl: interaction.options.getString("image"),
      thumbnailUrl: interaction.options.getString("miniature"),
      footer: interaction.options.getString("footer"),
      author: interaction.options.getString("auteur"),
      mention,
      buttonLabel: interaction.options.getString("bouton_texte"),
      buttonUrl: interaction.options.getString("bouton_url"),
    });
    if (!parsed.success) throw new UserError(parsed.error.issues.map((i) => `• ${i.path.join(".")} : ${i.message}`).join("\n"), "Annonce invalide");

    requireBotPermissions(interaction.guild.members.me!, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], channel);
    const authorPerms = interaction.member.permissionsIn(channel);
    if (!authorPerms.has(PermissionFlagsBits.SendMessages)) throw new UserError(`Vous n'avez pas la permission d'écrire dans ${channel.toString()}.`);
    if ((mention === "everyone" || mention === "here" || (role && !role.mentionable)) && !authorPerms.has(PermissionFlagsBits.MentionEveryone)) {
      throw new UserError("Vous n'avez pas la permission de mentionner @everyone, @here ou ce rôle.");
    }

    const scheduleRaw = interaction.options.getString("programmer");
    const scheduleAt = scheduleRaw ? parseScheduleDate(scheduleRaw) : null;
    if (scheduleRaw && !scheduleAt) throw new UserError("Date de programmation invalide. Exemples : `2026-10-09 18:30`, `09/10/2026 18:30`, `2h`.");
    if (scheduleAt && scheduleAt.getTime() < Date.now()) throw new UserError("La date de programmation est déjà passée.");

    const draft = await ctx.announcements.createDraft(interaction.guildId, interaction.user.id, parsed.data);
    const preview = buildAnnouncementMessage(draft, false);
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`announce:preview:${draft.id}`).setLabel("Aperçu").setEmoji("👁️").setStyle(ButtonStyle.Secondary),
      scheduleAt
        ? new ButtonBuilder().setCustomId(`announce:schedule:${draft.id}:${scheduleAt.getTime()}`).setLabel(`Programmer`).setEmoji("⏰").setStyle(ButtonStyle.Success)
        : new ButtonBuilder().setCustomId(`announce:publish:${draft.id}`).setLabel("Publier").setEmoji("📢").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`announce:cancel:${draft.id}`).setLabel("Annuler").setEmoji("❌").setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({
      content: `**Aperçu de l'annonce #${draft.id}** → ${channel.toString()}${scheduleAt ? ` · programmée pour <t:${Math.floor(scheduleAt.getTime() / 1000)}:F>` : ""}\n${preview.content ? `Mention : ${preview.content}` : ""}`,
      embeds: preview.embeds,
      components: [...(preview.components ?? []), buttons] as never,
      flags: "Ephemeral",
      allowedMentions: { parse: [] },
    });
  },
};

const verify: SlashCommand = {
  category: "Administration",
  level: (i) => (i.options.getSubcommand() === "setup" ? PermissionLevel.ADMIN : PermissionLevel.MODERATOR),
  data: new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Système de vérification")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName("setup")
        .setDescription("Publier le message de vérification avec bouton")
        .addChannelOption((o) => o.setName("salon").setDescription("Salon (par défaut : salon configuré)").addChannelTypes(ChannelType.GuildText)),
    )
    .addSubcommand((s) =>
      s
        .setName("user")
        .setDescription("Vérifier manuellement un membre")
        .addUserOption((o) => o.setName("membre").setDescription("Membre").setRequired(true)),
    )
    .toJSON(),
  async execute(interaction, ctx) {
    const cfg = await ctx.config.get(interaction.guildId);
    if (interaction.options.getSubcommand() === "user") {
      const member = interaction.options.getMember("membre");
      if (!member) throw new UserError("Ce membre est introuvable sur le serveur.");
      await interaction.deferReply({ flags: "Ephemeral" });
      await ctx.verification.verifyManually(member, actorOf(interaction));
      await reply(interaction, ok("Membre vérifié", `${member.toString()} a désormais accès au serveur.`));
      return;
    }
    const channel = interaction.options.getChannel("salon", false, [ChannelType.GuildText]) ?? (cfg.verification.channelId ? interaction.guild.channels.cache.get(cfg.verification.channelId) : null);
    if (!channel?.isTextBased()) throw new UserError("Indiquez un salon ou configurez `verification.channelId`.");
    ctx.verification.assertUsable(interaction.member, cfg);
    requireBotPermissions(interaction.guild.members.me!, [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], channel);
    const message = await ctx.verification.sendPanel(channel, cfg);
    await ctx.audit.record({ guildId: interaction.guildId, actorId: interaction.user.id, actorType: "USER", action: "verification.setup", targetId: channel.id, targetType: "channel" });
    await interaction.reply({ embeds: [ok("Message de vérification publié", `[Voir le message](${message.url})`)], flags: "Ephemeral" });
  },
};

export const adminCommands: SlashCommand[] = [config, announce, verify];
