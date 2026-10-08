import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { PermissionLevel } from "../../permissions/levels.js";
import { UserError } from "../errors.js";
import { ok, reply } from "./helpers.js";
import { requireBotPermissions } from "../permissions/index.js";
import { TICKET_CATEGORIES } from "../../modules/tickets/ticketService.js";
import type { TicketCategory } from "../../database/client.js";
import type { BotContext, SlashCommand } from "../types.js";
import type { ChatInputCommandInteraction } from "discord.js";

async function currentTicket(interaction: ChatInputCommandInteraction<"cached">, ctx: BotContext) {
  const ticket = await ctx.tickets.findByChannel(interaction.channelId);
  if (!ticket || ticket.guildId !== interaction.guildId) throw new UserError("Cette commande doit être utilisée dans un salon de ticket.");
  return ticket;
}

const ticket: SlashCommand = {
  category: "Tickets",
  level: (i) => (i.options.getSubcommand() === "panel" ? PermissionLevel.ADMIN : PermissionLevel.MEMBER),
  cooldownSeconds: 5,
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Système de tickets")
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName("open")
        .setDescription("Ouvrir un ticket")
        .addStringOption((o) =>
          o
            .setName("categorie")
            .setDescription("Type de demande")
            .setRequired(true)
            .addChoices(...(Object.keys(TICKET_CATEGORIES) as TicketCategory[]).map((k) => ({ name: `${TICKET_CATEGORIES[k].emoji} ${TICKET_CATEGORIES[k].label}`, value: k }))),
        )
        .addStringOption((o) => o.setName("sujet").setDescription("Sujet de la demande").setMaxLength(200)),
    )
    .addSubcommand((s) =>
      s
        .setName("close")
        .setDescription("Fermer le ticket actuel (transcript généré)")
        .addStringOption((o) => o.setName("raison").setDescription("Raison de fermeture").setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Ajouter un membre au ticket actuel")
        .addUserOption((o) => o.setName("membre").setDescription("Membre à ajouter").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("panel")
        .setDescription("Publier le panneau d'ouverture de tickets")
        .addChannelOption((o) => o.setName("salon").setDescription("Salon").setRequired(true).addChannelTypes(ChannelType.GuildText)),
    )
    .toJSON(),
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === "open") {
      await interaction.deferReply({ flags: "Ephemeral" });
      const channel = await ctx.tickets.open(interaction.member, interaction.options.getString("categorie", true) as TicketCategory, interaction.options.getString("sujet"));
      await reply(interaction, ok("Ticket créé", `Votre ticket est ouvert : ${channel.toString()}`));
      return;
    }
    if (sub === "close") {
      const t = await currentTicket(interaction, ctx);
      await interaction.deferReply();
      const res = await ctx.tickets.close(t.id, interaction.member, interaction.options.getString("raison") ?? "Aucune raison fournie");
      await reply(interaction, ok(`Ticket #${t.number} fermé`, `Transcript généré (${res.messageCount} messages).`), false);
      return;
    }
    if (sub === "add") {
      const t = await currentTicket(interaction, ctx);
      const member = interaction.options.getMember("membre");
      if (!member) throw new UserError("Ce membre est introuvable sur le serveur.");
      await interaction.deferReply({ flags: "Ephemeral" });
      await ctx.tickets.addMember(t.id, interaction.member, member);
      await reply(interaction, ok("Membre ajouté", `${member.toString()} a accès au ticket.`));
      return;
    }
    const channel = interaction.options.getChannel("salon", true, [ChannelType.GuildText]);
    requireBotPermissions(interaction.guild.members.me!, [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], channel);
    const message = await ctx.tickets.sendPanel(channel);
    await ctx.audit.record({ guildId: interaction.guildId, actorId: interaction.user.id, actorType: "USER", action: "ticket.panel", targetId: channel.id, targetType: "channel" });
    await interaction.reply({ embeds: [ok("Panneau publié", `[Voir le message](${message.url})`)], flags: "Ephemeral" });
  },
};

export const ticketCommands: SlashCommand[] = [ticket];
