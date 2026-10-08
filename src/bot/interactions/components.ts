import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
} from "discord.js";
import { PermissionLevel } from "../../permissions/levels.js";
import { memberLevel } from "../permissions/index.js";
import { UserError } from "../errors.js";
import { errorEmbed, infoEmbed, successEmbed, warningEmbed } from "../ui/embeds.js";
import { buildAnnouncementMessage } from "../../modules/announcements/announcementService.js";
import type { TicketCategory } from "../../database/client.js";
import { TICKET_CATEGORIES } from "../../modules/tickets/ticketService.js";
import type { BotContext, ComponentHandler, ComponentInteraction } from "../types.js";

const parseId = (raw: string | undefined): number => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new UserError("Identifiant invalide.");
  return id;
};

// ─── Vérification ───────────────────────────────────────────

const verifyHandler: ComponentHandler = {
  prefix: "verify",
  async execute(interaction, ctx) {
    if (!interaction.isButton()) return;
    await interaction.deferReply({ flags: "Ephemeral" });
    const message = await ctx.verification.verifySelf(interaction.member);
    await interaction.editReply({ embeds: [successEmbed("Vérification", message)] });
  },
};

// ─── Tickets ────────────────────────────────────────────────

const ticketHandler: ComponentHandler = {
  prefix: "ticket",
  async execute(interaction, ctx, [action, rawId]) {
    switch (action) {
      case "open": {
        if (!interaction.isStringSelectMenu()) return;
        const category = interaction.values[0] as TicketCategory;
        if (!(category in TICKET_CATEGORIES)) throw new UserError("Catégorie inconnue.");
        await interaction.deferReply({ flags: "Ephemeral" });
        const channel = await ctx.tickets.open(interaction.member, category, null);
        await interaction.editReply({ embeds: [successEmbed("Ticket créé", `Votre ticket est ouvert : ${channel.toString()}`)] });
        return;
      }
      case "claim": {
        const ticket = await ctx.tickets.claim(parseId(rawId), interaction.member);
        await interaction.reply({ embeds: [infoEmbed("Ticket pris en charge", `${interaction.member.toString()} s'occupe de ce ticket (#${ticket.number}).`)] });
        return;
      }
      case "add": {
        const ticketId = parseId(rawId);
        const config = await ctx.config.get(interaction.guildId);
        const ticket = await ctx.tickets.getTicket(ticketId, interaction.guildId);
        if (!ctx.tickets.isStaff(interaction.member, config) && ticket.creatorId !== interaction.user.id) throw new UserError("Seuls l'équipe et le créateur du ticket peuvent ajouter un membre.");
        const menu = new UserSelectMenuBuilder().setCustomId(`ticket:adduser:${ticketId}`).setPlaceholder("Choisissez le membre à ajouter").setMinValues(1).setMaxValues(1);
        await interaction.reply({ components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(menu)], flags: "Ephemeral" });
        return;
      }
      case "adduser": {
        if (!interaction.isUserSelectMenu()) return;
        const target = interaction.members.first() ?? (await interaction.guild.members.fetch(interaction.values[0]!).catch(() => null));
        if (!target || !("roles" in target)) throw new UserError("Ce membre est introuvable sur le serveur.");
        await interaction.deferUpdate();
        await ctx.tickets.addMember(parseId(rawId), interaction.member, await interaction.guild.members.fetch(target.id));
        await interaction.editReply({ embeds: [successEmbed("Membre ajouté", `<@${target.id}> a accès au ticket.`)], components: [] });
        return;
      }
      case "close": {
        const ticketId = parseId(rawId);
        const modal = new ModalBuilder()
          .setCustomId(`ticket:closemodal:${ticketId}`)
          .setTitle("Fermer le ticket")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId("reason").setLabel("Raison de fermeture").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500),
            ),
          );
        if (!interaction.isButton()) return;
        await interaction.showModal(modal);
        return;
      }
      case "closemodal": {
        if (!interaction.isModalSubmit()) return;
        const reason = interaction.fields.getTextInputValue("reason").trim() || "Aucune raison fournie";
        await interaction.deferReply();
        const res = await ctx.tickets.close(parseId(rawId), interaction.member, reason);
        await interaction.editReply({ embeds: [successEmbed(`Ticket #${res.ticket.number} fermé`, `Transcript généré (${res.messageCount} messages).`)] });
        return;
      }
      case "delete": {
        const ticketId = parseId(rawId);
        const config = await ctx.config.get(interaction.guildId);
        if (!ctx.tickets.isStaff(interaction.member, config)) throw new UserError("Seule l'équipe peut supprimer un ticket.");
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`ticket:deleteconfirm:${ticketId}`).setLabel("Supprimer définitivement").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
        );
        await interaction.reply({ embeds: [warningEmbed("⚠️ CONFIRMATION", "Le salon sera supprimé. Le transcript est conservé en base et dans les logs.")], components: [row], flags: "Ephemeral" });
        return;
      }
      case "deleteconfirm": {
        await interaction.deferUpdate();
        await ctx.tickets.delete(parseId(rawId), interaction.member);
        await interaction.editReply({ embeds: [successEmbed("Ticket supprimé", "Le salon sera supprimé dans 5 secondes.")], components: [] });
        return;
      }
      default:
        throw new UserError("Action inconnue.");
    }
  },
};

// ─── Annonces ───────────────────────────────────────────────

async function assertAnnouncementRights(interaction: ComponentInteraction, ctx: BotContext, authorId: string): Promise<void> {
  const config = await ctx.config.get(interaction.guildId);
  if (interaction.user.id !== authorId && memberLevel(interaction.member, config) < PermissionLevel.ADMIN) {
    throw new UserError("Seul l'auteur de l'annonce ou un administrateur peut la gérer.");
  }
}

const announceHandler: ComponentHandler = {
  prefix: "announce",
  async execute(interaction, ctx, [action, rawId, rawTs]) {
    if (!interaction.isButton()) return;
    const id = parseId(rawId);
    const announcement = await ctx.announcements.get(id, interaction.guildId);
    await assertAnnouncementRights(interaction, ctx, announcement.authorId);
    const btn = interaction as ButtonInteraction<"cached">;
    switch (action) {
      case "preview": {
        const preview = buildAnnouncementMessage(announcement, false);
        await btn.reply({ content: `👁️ Aperçu — ${preview.content ?? "sans mention"}`, embeds: preview.embeds, components: preview.components as never, flags: "Ephemeral", allowedMentions: { parse: [] } });
        return;
      }
      case "publish": {
        await btn.update({ embeds: [infoEmbed("Publication en cours…")], components: [], content: "" });
        const published = await ctx.announcements.publish(id, interaction.guildId, interaction.user.id);
        await btn.editReply({ embeds: [successEmbed("Annonce publiée", `Annonce #${id} publiée dans <#${published.channelId}>.`)], components: [] });
        return;
      }
      case "schedule": {
        const at = new Date(Number(rawTs));
        if (Number.isNaN(at.getTime())) throw new UserError("Date de programmation invalide.");
        await ctx.announcements.schedule(id, interaction.guildId, at, interaction.user.id);
        await btn.update({ content: "", embeds: [successEmbed("Annonce programmée", `L'annonce #${id} sera publiée <t:${Math.floor(at.getTime() / 1000)}:F> (<t:${Math.floor(at.getTime() / 1000)}:R>).`)], components: [] });
        return;
      }
      case "cancel": {
        await ctx.announcements.cancel(id, interaction.guildId, interaction.user.id);
        await btn.update({ content: "", embeds: [errorEmbed("Annonce annulée", `L'annonce #${id} ne sera pas publiée.`)], components: [] });
        return;
      }
      default:
        throw new UserError("Action inconnue.");
    }
  },
};

export function createComponentHandlers(ctx: BotContext): Map<string, ComponentHandler> {
  const handlers = [ctx.confirmations.handler, verifyHandler, ticketHandler, announceHandler];
  return new Map(handlers.map((h) => [h.prefix, h]));
}

