import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { PermissionLevel } from "../../permissions/levels.js";
import { UserError } from "../errors.js";
import { Colors, discordDate, securityEmbed } from "../ui/embeds.js";
import { actorOf, ok, reasonOf, reply } from "./helpers.js";
import { LEVEL_EMOJIS, LEVEL_LABELS } from "../../modules/security/riskEngine.js";
import { SIMULATION_KINDS, type SimulationKind } from "../../modules/security/simulation.js";
import { extractInviteCodes, normalizeHost } from "../../modules/security/antiPhishing/detector.js";
import type { SlashCommand } from "../types.js";

const lockdown: SlashCommand = {
  category: "Sécurité",
  level: PermissionLevel.ADMIN,
  data: new SlashCommandBuilder()
    .setName("lockdown")
    .setDescription("Activer le lockdown du serveur (mesures réversibles)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addStringOption((o) => o.setName("raison").setDescription("Raison du lockdown").setRequired(true).setMaxLength(500))
    .toJSON(),
  async execute(interaction, ctx) {
    if (ctx.lockdown.isActive(interaction.guildId)) throw new UserError("Le lockdown est déjà actif. Utilisez `/unlock` pour le lever.");
    const reason = reasonOf(interaction, true)!;
    const config = await ctx.config.get(interaction.guildId);
    const plan = [
      config.lockdown.raiseVerificationLevel ? "• Niveau de vérification Discord relevé" : null,
      config.lockdown.pauseInvites ? "• Invitations suspendues" : null,
      config.lockdown.sensitiveChannelIds.length ? `• ${config.lockdown.sensitiveChannelIds.length} salon(s) sensible(s) restreint(s)` : null,
      config.verification.unverifiedRoleId ? `• Nouvelles arrivées (et arrivées des ${config.lockdown.quarantineRecentMinutes} dernières minutes) placées en quarantaine` : "• ⚠️ Aucun rôle non vérifié configuré : pas de quarantaine",
    ].filter(Boolean);
    await ctx.confirmations.prompt(interaction, {
      title: "Lockdown",
      description: `Mesures prévues :\n${plan.join("\n")}\n\n**Raison :** ${reason}\nToutes les modifications seront restaurées avec \`/unlock\`.`,
      confirmEmoji: "🔒",
      onConfirm: async (button) => {
        const summary = await ctx.lockdown.activate(interaction.guild, actorOf(interaction), reason);
        await reply(
          button,
          securityEmbed("🔴 Lockdown activé", [...summary.steps.map((s) => `✅ ${s}`), ...summary.warnings.map((w) => `⚠️ ${w}`)].join("\n") || "Aucune mesure appliquée."),
        );
      },
    });
  },
};

const unlock: SlashCommand = {
  category: "Sécurité",
  level: PermissionLevel.ADMIN,
  data: new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Lever le lockdown et restaurer la configuration précédente")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addStringOption((o) => o.setName("raison").setDescription("Raison").setMaxLength(500))
    .toJSON(),
  async execute(interaction, ctx) {
    await interaction.deferReply({ flags: "Ephemeral" });
    const summary = await ctx.lockdown.deactivate(interaction.guild, actorOf(interaction), reasonOf(interaction) ?? "Levée manuelle");
    await reply(interaction, ok("Lockdown levé", [...summary.steps.map((s) => `✅ ${s}`), ...summary.warnings.map((w) => `⚠️ ${w}`)].join("\n") || "Rien à restaurer."));
  },
};

const SIM_LABELS: Record<SimulationKind, string> = { raid: "Raid", spam: "Spam", nuke: "Anti-nuke", phishing: "Phishing", alt: "Compte suspect" };

const security: SlashCommand = {
  category: "Sécurité",
  level: (i) => (i.options.getSubcommand() === "status" ? PermissionLevel.MODERATOR : PermissionLevel.ADMIN),
  data: new SlashCommandBuilder()
    .setName("security")
    .setDescription("Système de sécurité")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(0)
    .addSubcommand((s) => s.setName("status").setDescription("État de la sécurité du serveur"))
    .addSubcommand((s) =>
      s
        .setName("test")
        .setDescription("Simuler une menace sans aucune action réelle")
        .addStringOption((o) => o.setName("scenario").setDescription("Scénario à simuler").setRequired(true).addChoices(...SIMULATION_KINDS.map((k) => ({ name: SIM_LABELS[k], value: k })))),
    )
    .addSubcommand((s) => s.setName("reset").setDescription("Remettre le score de menace à zéro"))
    .toJSON(),
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === "status") {
      const config = await ctx.config.get(interaction.guildId);
      const { score, level } = ctx.security.risk.peek(interaction.guildId);
      const lock = await ctx.lockdown.state(interaction.guildId);
      const since = new Date(Date.now() - 24 * 3_600_000);
      const events = await ctx.prisma.securityEvent.groupBy({ by: ["type"], where: { guildId: interaction.guildId, createdAt: { gte: since }, simulated: false }, _count: true });
      const count = (t: string) => events.find((e) => e.type === t)?._count ?? 0;
      const onOff = (b: boolean) => (b ? "🟢 ON" : "⚫ OFF");
      const t = config.riskEngine.thresholds;
      const embed = new EmbedBuilder()
        .setColor(level === "NORMAL" ? Colors.success : level === "LOCKDOWN" ? Colors.error : Colors.warning)
        .setTitle("🛡️ SECURITY STATUS")
        .setDescription(`${LEVEL_EMOJIS[level]} **${level === "NORMAL" ? "Serveur sécurisé" : LEVEL_LABELS[level]}**\nScore de menace : **${score}** (surveillance ≥ ${t.surveillance} · renforcé ≥ ${t.reinforced} · lockdown ≥ ${t.lockdown})`)
        .addFields(
          { name: "Anti-Raid", value: onOff(config.antiRaid.enabled), inline: true },
          { name: "Anti-Spam", value: onOff(config.antiSpam.enabled), inline: true },
          { name: "Anti-Nuke", value: onOff(config.antiNuke.enabled), inline: true },
          { name: "Anti-Phishing", value: onOff(config.antiPhishing.enabled), inline: true },
          { name: "Anti-Alt", value: onOff(config.antiAlt.enabled), inline: true },
          { name: "Anti-Bot", value: onOff(config.antiBot.enabled), inline: true },
          { name: "Vérification", value: onOff(config.verification.enabled), inline: true },
          { name: "Lockdown", value: lock?.active ? `🔴 Actif depuis ${discordDate(lock.startedAt!)}${lock.automatic ? " (auto)" : ""}` : "⚫ Inactif", inline: true },
          { name: "Lockdown auto", value: onOff(config.riskEngine.autoLockdown), inline: true },
          { name: "Dernières 24 h", value: `Raids : **${count("RAID")}** · Spam : **${count("SPAM")}** · Phishing : **${count("PHISHING")}** · Nuke : **${count("NUKE")}** · Comptes suspects : **${count("ALT")}** · Bots : **${count("BOT_ADDED")}**` },
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: "Ephemeral" });
      return;
    }
    if (sub === "test") {
      const kind = interaction.options.getString("scenario", true) as SimulationKind;
      const result = await ctx.security.simulate(interaction.guild, kind, actorOf(interaction));
      const embed = new EmbedBuilder()
        .setColor(Colors.security)
        .setTitle("🧪 MODE SIMULATION")
        .addFields(
          { name: "Événement détecté", value: result.eventLabel, inline: true },
          { name: "Niveau de menace", value: result.threat, inline: true },
          { name: "Action qui aurait été appliquée", value: result.action },
          { name: "Détails", value: result.details.join("\n").slice(0, 1024) },
        )
        .setFooter({ text: "Aucune action réelle n'a été effectuée." })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: "Ephemeral" });
      return;
    }
    await ctx.confirmations.prompt(interaction, {
      title: "Réinitialisation du score",
      description: "Le score de menace sera remis à 0 et le niveau repassera à NORMAL. Le lockdown éventuel n'est pas levé.",
      danger: false,
      onConfirm: async (button) => {
        await ctx.security.resetScore(interaction.guild, actorOf(interaction));
        await reply(button, ok("Score réinitialisé", "Niveau de sécurité : 🟢 NORMAL"));
      },
    });
  },
};

function listCommand(kind: "whitelist" | "blacklist"): SlashCommand {
  const name = kind === "whitelist" ? "whitelist-domain" : "blacklist-domain";
  return {
    category: "Sécurité",
    level: (i) => (i.options.getSubcommand() === "list" ? PermissionLevel.MODERATOR : PermissionLevel.ADMIN),
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(kind === "whitelist" ? "Gérer les domaines / invitations autorisés" : "Gérer les domaines interdits")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setContexts(0)
      .addSubcommand((s) =>
        s
          .setName("add")
          .setDescription(kind === "whitelist" ? "Autoriser un domaine ou une invitation" : "Interdire un domaine")
          .addStringOption((o) => o.setName("valeur").setDescription(kind === "whitelist" ? "Domaine (exemple.com) ou lien d'invitation" : "Domaine (exemple.com)").setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName("raison").setDescription("Raison").setMaxLength(200)),
      )
      .addSubcommand((s) =>
        s.setName("remove").setDescription("Retirer de la liste").addStringOption((o) => o.setName("valeur").setDescription("Domaine ou code d'invitation").setRequired(true).setMaxLength(200)),
      )
      .addSubcommand((s) => s.setName("list").setDescription("Afficher la liste"))
      .toJSON(),
    async execute(interaction, ctx) {
      const sub = interaction.options.getSubcommand();
      if (sub === "list") {
        const [domains, invites] = await Promise.all([ctx.lists.list(kind, interaction.guildId, "DOMAIN"), kind === "whitelist" ? ctx.lists.list(kind, interaction.guildId, "INVITE") : Promise.resolve([])]);
        const lines = [...domains.map((d) => `🌐 \`${d.value}\`${d.reason ? ` — ${d.reason}` : ""}`), ...invites.map((d) => `✉️ \`discord.gg/${d.value}\`${d.reason ? ` — ${d.reason}` : ""}`)];
        await interaction.reply({
          embeds: [securityEmbed(kind === "whitelist" ? "Liste blanche" : "Liste noire", lines.length ? lines.slice(0, 50).join("\n") : "La liste est vide.").setFooter({ text: `${lines.length} entrée(s)` })],
          flags: "Ephemeral",
        });
        return;
      }
      const raw = interaction.options.getString("valeur", true).trim();
      const invite = extractInviteCodes(raw)[0];
      const type = invite && kind === "whitelist" ? ("INVITE" as const) : ("DOMAIN" as const);
      const value = type === "INVITE" ? invite!.toLowerCase() : normalizeHost(raw);
      if (!value) throw new UserError("Domaine invalide. Exemple : `exemple.com`.");
      if (sub === "add") {
        await ctx.lists.add(kind, interaction.guildId, type, value, interaction.user.id, interaction.options.getString("raison"));
        await ctx.audit.record({ guildId: interaction.guildId, actorId: interaction.user.id, actorType: "USER", action: `${kind}.add`, targetId: value, targetType: type.toLowerCase() });
        await interaction.reply({ embeds: [ok(kind === "whitelist" ? "Ajouté à la liste blanche" : "Ajouté à la liste noire", `\`${value}\``)], flags: "Ephemeral" });
      } else {
        const removed = await ctx.lists.remove(kind, interaction.guildId, type, value);
        if (!removed) throw new UserError(`\`${value}\` n'est pas dans la liste.`);
        await ctx.audit.record({ guildId: interaction.guildId, actorId: interaction.user.id, actorType: "USER", action: `${kind}.remove`, targetId: value, targetType: type.toLowerCase() });
        await interaction.reply({ embeds: [ok("Retiré de la liste", `\`${value}\``)], flags: "Ephemeral" });
      }
    },
  };
}

export const securityCommands: SlashCommand[] = [lockdown, unlock, security, listCommand("whitelist"), listCommand("blacklist")];
