import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  OverwriteType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type Collection,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type OverwriteResolvable,
  type TextChannel,
} from "discord.js";
import type { PrismaClient, Ticket, TicketCategory } from "../../database/client.js";
import type { GuildConfig } from "../../config/guildConfig.js";
import type { GuildConfigService } from "../../services/guildConfigService.js";
import type { AuditService } from "../../services/auditService.js";
import { auditEmbed, type LogService } from "../logs/logService.js";
import { Colors, infoEmbed } from "../../bot/ui/embeds.js";
import { attempt, UserError } from "../../bot/errors.js";
import { memberLevel } from "../../bot/permissions/index.js";
import { PermissionLevel } from "../../permissions/levels.js";
import { buildTranscriptHtml, type TranscriptMessage } from "./transcript.js";

export const TICKET_CATEGORIES: Record<TicketCategory, { label: string; emoji: string; description: string }> = {
  SUPPORT: { label: "Support", emoji: "🛠️", description: "Besoin d'aide technique ou générale" },
  REPORT: { label: "Signalement", emoji: "🚨", description: "Signaler un membre ou un problème" },
  PARTNERSHIP: { label: "Partenariat", emoji: "🤝", description: "Proposer un partenariat" },
  QUESTION: { label: "Question", emoji: "💬", description: "Poser une question à l'équipe" },
  PURCHASE: { label: "Achat", emoji: "🛒", description: "Question liée à un achat" },
  OTHER: { label: "Autre", emoji: "📋", description: "Toute autre demande" },
};

const MAX_TRANSCRIPT_MESSAGES = 5000;

export class TicketService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly configs: GuildConfigService,
    private readonly logs: LogService,
    private readonly audit: AuditService,
  ) {}

  isStaff(member: GuildMember, config: GuildConfig): boolean {
    return memberLevel(member, config) >= PermissionLevel.SUPPORT || config.tickets.staffRoleIds.some((r) => member.roles.cache.has(r));
  }

  async getTicket(id: number, guildId: string): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findFirst({ where: { id, guildId } });
    if (!ticket) throw new UserError("Ticket introuvable.");
    return ticket;
  }

  async findByChannel(channelId: string): Promise<Ticket | null> {
    return this.prisma.ticket.findUnique({ where: { channelId } });
  }

  panelComponents() {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("ticket:open")
      .setPlaceholder("Choisissez le type de demande…")
      .addOptions(
        (Object.keys(TICKET_CATEGORIES) as TicketCategory[]).map((key) => ({
          label: TICKET_CATEGORIES[key].label,
          value: key,
          emoji: TICKET_CATEGORIES[key].emoji,
          description: TICKET_CATEGORIES[key].description,
        })),
      );
    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
  }

  async sendPanel(channel: GuildTextBasedChannel): Promise<Message> {
    const embed = new EmbedBuilder()
      .setColor(Colors.info)
      .setTitle("🎫 Ouvrir un ticket")
      .setDescription(
        "Sélectionnez la catégorie correspondant à votre demande. Un salon privé sera créé avec l'équipe.\n\n" +
          (Object.keys(TICKET_CATEGORIES) as TicketCategory[]).map((k) => `${TICKET_CATEGORIES[k].emoji} **${TICKET_CATEGORIES[k].label}** — ${TICKET_CATEGORIES[k].description}`).join("\n"),
      );
    return channel.send({ embeds: [embed], components: this.panelComponents() });
  }

  private ticketButtons(ticketId: number, closed: boolean) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    if (!closed) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`ticket:claim:${ticketId}`).setLabel("Prendre en charge").setEmoji("🙋").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ticket:add:${ticketId}`).setLabel("Ajouter un membre").setEmoji("➕").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`ticket:close:${ticketId}`).setLabel("Fermer").setEmoji("🔒").setStyle(ButtonStyle.Secondary),
      );
    }
    row.addComponents(new ButtonBuilder().setCustomId(`ticket:delete:${ticketId}`).setLabel("Supprimer").setEmoji("🗑️").setStyle(ButtonStyle.Danger));
    return [row];
  }

  async open(member: GuildMember, category: TicketCategory, subject: string | null): Promise<TextChannel> {
    const guild = member.guild;
    const config = await this.configs.get(guild.id);
    if (!config.tickets.enabled) throw new UserError("Le système de tickets est désactivé sur ce serveur.");
    const openCount = await this.prisma.ticket.count({ where: { guildId: guild.id, creatorId: member.id, status: { in: ["OPEN", "CLAIMED"] } } });
    if (openCount >= config.tickets.maxOpenPerUser) {
      throw new UserError(`Vous avez déjà ${openCount} ticket(s) ouvert(s). Fermez-en un avant d'en ouvrir un nouveau.`);
    }
    const me = guild.members.me;
    if (!me?.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
      throw new UserError("Il me manque les permissions « Gérer les salons » et « Gérer les rôles » pour créer un ticket.");
    }
    const parent = config.tickets.categoryChannelId ? guild.channels.cache.get(config.tickets.categoryChannelId) : null;
    if (config.tickets.categoryChannelId && parent?.type !== ChannelType.GuildCategory) {
      throw new UserError("La catégorie de tickets configurée n'existe plus. Un administrateur doit la reconfigurer.");
    }

    const { ticketCounter } = await this.prisma.guild.update({ where: { id: guild.id }, data: { ticketCounter: { increment: 1 } }, select: { ticketCounter: true } });
    const memberPerms = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
    const staffRoles = [...new Set([...config.tickets.staffRoleIds, ...config.permissions.supportRoleIds, ...config.permissions.moderatorRoleIds, ...config.permissions.adminRoleIds])].filter((id) => guild.roles.cache.has(id));
    const overwrites: OverwriteResolvable[] = [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
      { id: me.id, type: OverwriteType.Member, allow: [...memberPerms, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
      { id: member.id, type: OverwriteType.Member, allow: memberPerms },
      ...staffRoles.map((id) => ({ id, type: OverwriteType.Role, allow: [...memberPerms, PermissionFlagsBits.ManageMessages] })),
    ];
    const name = `ticket-${String(ticketCounter).padStart(4, "0")}-${member.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 90);
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parent?.id,
      permissionOverwrites: overwrites,
      topic: `Ticket #${ticketCounter} · ${TICKET_CATEGORIES[category].label} · ${member.user.tag} (${member.id})`,
      reason: `Ticket ouvert par ${member.user.tag}`,
    });

    const ticket = await this.prisma.ticket.create({
      data: { guildId: guild.id, number: ticketCounter, channelId: channel.id, creatorId: member.id, category, subject, participants: [member.id] },
    });

    const cat = TICKET_CATEGORIES[category];
    const embed = new EmbedBuilder()
      .setColor(Colors.info)
      .setTitle(`${cat.emoji} Ticket #${ticketCounter} — ${cat.label}`)
      .setDescription(`Bonjour ${member.toString()}, merci pour votre demande.\nUn membre de l'équipe va vous répondre rapidement. Décrivez votre demande en détail ci-dessous.`)
      .addFields({ name: "Sujet", value: subject?.slice(0, 1024) || "Non précisé" })
      .setTimestamp();
    await channel.send({
      content: `${member.toString()}${staffRoles.length ? ` · ${staffRoles.map((r) => `<@&${r}>`).join(" ")}` : ""}`,
      embeds: [embed],
      components: this.ticketButtons(ticket.id, false),
      allowedMentions: { users: [member.id], roles: staffRoles },
    });
    await this.audit.record({ guildId: guild.id, actorId: member.id, actorType: "USER", action: "ticket.open", targetId: String(ticket.id), targetType: "ticket", details: { category, number: ticketCounter } });
    await this.logs.send(guild, "tickets", {
      embeds: [auditEmbed({ action: `🎫 Ticket #${ticketCounter} ouvert`, actor: `${member.toString()} (${member.user.tag})`, target: channel.toString(), reason: subject, result: "Succès", color: Colors.info, extra: [{ name: "Catégorie", value: `${cat.emoji} ${cat.label}`, inline: true }] })],
    });
    return channel;
  }

  async claim(ticketId: number, staff: GuildMember): Promise<Ticket> {
    const config = await this.configs.get(staff.guild.id);
    if (!this.isStaff(staff, config)) throw new UserError("Seule l'équipe peut prendre en charge un ticket.");
    const ticket = await this.getTicket(ticketId, staff.guild.id);
    if (ticket.status === "CLOSED" || ticket.status === "DELETED") throw new UserError("Ce ticket est fermé.");
    if (ticket.claimedById === staff.id) throw new UserError("Vous avez déjà pris en charge ce ticket.");
    const updated = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { claimedById: staff.id, status: "CLAIMED", handledBy: ticket.handledBy.includes(staff.id) ? undefined : { push: staff.id } },
    });
    await this.audit.record({ guildId: staff.guild.id, actorId: staff.id, actorType: "USER", action: "ticket.claim", targetId: String(ticket.id), targetType: "ticket" });
    return updated;
  }

  async addMember(ticketId: number, staff: GuildMember, target: GuildMember): Promise<void> {
    const config = await this.configs.get(staff.guild.id);
    const ticket = await this.getTicket(ticketId, staff.guild.id);
    if (!this.isStaff(staff, config) && ticket.creatorId !== staff.id) throw new UserError("Seuls l'équipe et le créateur du ticket peuvent ajouter un membre.");
    if (ticket.status === "CLOSED" || ticket.status === "DELETED" || !ticket.channelId) throw new UserError("Ce ticket est fermé.");
    const channel = staff.guild.channels.cache.get(ticket.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) throw new UserError("Le salon du ticket n'existe plus.");
    await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }, { reason: `Ajouté au ticket par ${staff.user.tag}` });
    if (!ticket.participants.includes(target.id)) await this.prisma.ticket.update({ where: { id: ticket.id }, data: { participants: { push: target.id } } });
    await this.audit.record({ guildId: staff.guild.id, actorId: staff.id, actorType: "USER", action: "ticket.add_member", targetId: target.id, targetType: "user", details: { ticketId } });
    await channel.send({ embeds: [infoEmbed("Membre ajouté", `${target.toString()} a été ajouté au ticket par ${staff.toString()}.`)] });
  }

  private async fetchAllMessages(channel: TextChannel): Promise<Message[]> {
    const all: Message[] = [];
    let before: string | undefined;
    while (all.length < MAX_TRANSCRIPT_MESSAGES) {
      const batch: Collection<string, Message> = await channel.messages.fetch({ limit: 100, before });
      if (batch.size === 0) break;
      all.push(...batch.values());
      before = batch.last()!.id;
      if (batch.size < 100) break;
    }
    return all.reverse();
  }

  /** Ferme un ticket : transcript, verrouillage du salon, enregistrement et log. */
  async close(ticketId: number, actor: GuildMember, reason: string): Promise<{ ticket: Ticket; messageCount: number }> {
    const guild = actor.guild;
    const config = await this.configs.get(guild.id);
    const ticket = await this.getTicket(ticketId, guild.id);
    if (!this.isStaff(actor, config) && ticket.creatorId !== actor.id) throw new UserError("Seuls l'équipe et le créateur du ticket peuvent le fermer.");
    if (ticket.status === "CLOSED" || ticket.status === "DELETED") throw new UserError("Ce ticket est déjà fermé.");

    const channel = ticket.channelId ? guild.channels.cache.get(ticket.channelId) : null;
    let messages: Message[] = [];
    if (channel?.type === ChannelType.GuildText) messages = await this.fetchAllMessages(channel);

    const transcriptMessages: TranscriptMessage[] = messages.map((m) => ({
      authorTag: m.author.tag,
      authorId: m.author.id,
      authorBot: m.author.bot,
      content: m.content,
      attachments: [...m.attachments.values()].map((a) => a.url),
      embeds: m.embeds.length,
      createdAt: m.createdAt,
    }));
    const creator = await guild.client.users.fetch(ticket.creatorId).catch(() => null);
    const claimedBy = ticket.claimedById ? await guild.client.users.fetch(ticket.claimedById).catch(() => null) : null;
    const closedAt = new Date();
    const html = buildTranscriptHtml(
      {
        guildName: guild.name,
        ticketNumber: ticket.number,
        category: TICKET_CATEGORIES[ticket.category].label,
        creatorTag: creator?.tag ?? ticket.creatorId,
        creatorId: ticket.creatorId,
        claimedBy: claimedBy?.tag ?? null,
        closedBy: actor.user.tag,
        closeReason: reason,
        openedAt: ticket.createdAt,
        closedAt,
      },
      transcriptMessages,
    );

    const handledBy = [...new Set([...ticket.handledBy, ...messages.filter((m) => !m.author.bot && m.author.id !== ticket.creatorId).map((m) => m.author.id)])];
    const [, updated] = await this.prisma.$transaction([
      this.prisma.ticketMessage.createMany({
        data: messages.map((m) => ({
          ticketId: ticket.id,
          messageId: m.id,
          authorId: m.author.id,
          authorTag: m.author.tag,
          authorBot: m.author.bot,
          content: m.content,
          attachments: [...m.attachments.values()].map((a) => ({ name: a.name, url: a.url, size: a.size })),
          embeds: m.embeds.length,
          createdAt: m.createdAt,
        })),
        skipDuplicates: true,
      }),
      this.prisma.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED", closedById: actor.id, closeReason: reason, closedAt, transcript: html, handledBy } }),
    ]);

    if (channel?.type === ChannelType.GuildText) {
      for (const userId of ticket.participants) await attempt(channel.permissionOverwrites.edit(userId, { SendMessages: false }, { reason: "Ticket fermé" }));
      await attempt(
        channel.send({
          embeds: [new EmbedBuilder().setColor(Colors.neutral).setTitle("🔒 Ticket fermé").setDescription(`Fermé par ${actor.toString()}\n**Raison :** ${reason}`).setTimestamp()],
          components: this.ticketButtons(ticket.id, true),
        }),
      );
      await attempt(channel.setName(`ferme-${channel.name.replace(/^ticket-/, "")}`.slice(0, 100)));
    }

    const file = () => new AttachmentBuilder(Buffer.from(html, "utf8"), { name: `ticket-${ticket.number}.html` });
    await this.logs.send(guild, "tickets", {
      embeds: [
        auditEmbed({
          action: `🔒 Ticket #${ticket.number} fermé`,
          actor: `${actor.toString()} (${actor.user.tag})`,
          target: `<@${ticket.creatorId}> (\`${ticket.creatorId}\`)`,
          reason,
          result: "Succès",
          color: Colors.neutral,
          extra: [
            { name: "Catégorie", value: TICKET_CATEGORIES[ticket.category].label, inline: true },
            { name: "Messages", value: String(messages.length), inline: true },
            { name: "Équipe", value: handledBy.map((id) => `<@${id}>`).join(", ") || "—" },
          ],
        }),
      ],
      files: [file()],
    });
    if (config.tickets.transcriptToCreator && creator) {
      await attempt(creator.send({ content: `Transcript de votre ticket #${ticket.number} sur **${guild.name}**`, files: [file()] }));
    }
    await this.audit.record({ guildId: guild.id, actorId: actor.id, actorType: "USER", action: "ticket.close", targetId: String(ticket.id), targetType: "ticket", reason, details: { messages: messages.length } });
    return { ticket: updated, messageCount: messages.length };
  }

  async delete(ticketId: number, actor: GuildMember): Promise<void> {
    const config = await this.configs.get(actor.guild.id);
    if (!this.isStaff(actor, config)) throw new UserError("Seule l'équipe peut supprimer un ticket.");
    let ticket = await this.getTicket(ticketId, actor.guild.id);
    if (ticket.status === "DELETED") throw new UserError("Ce ticket est déjà supprimé.");
    if (ticket.status !== "CLOSED") ticket = (await this.close(ticketId, actor, "Supprimé sans fermeture préalable")).ticket;
    await this.prisma.ticket.update({ where: { id: ticket.id }, data: { status: "DELETED", deletedAt: new Date(), channelId: null } });
    await this.audit.record({ guildId: actor.guild.id, actorId: actor.id, actorType: "USER", action: "ticket.delete", targetId: String(ticket.id), targetType: "ticket" });
    const channel = ticket.channelId ? actor.guild.channels.cache.get(ticket.channelId) : null;
    if (channel) {
      setTimeout(() => void attempt(async () => { await channel.delete(`Ticket #${ticket.number} supprimé par ${actor.user.tag}`); }), 5000).unref();
    }
  }

  /** Nettoyage si un salon de ticket est supprimé manuellement. */
  async onChannelDelete(guild: Guild, channelId: string): Promise<void> {
    await this.prisma.ticket.updateMany({ where: { guildId: guild.id, channelId, status: { in: ["OPEN", "CLAIMED"] } }, data: { status: "DELETED", deletedAt: new Date(), closeReason: "Salon supprimé manuellement" } });
    await this.prisma.ticket.updateMany({ where: { guildId: guild.id, channelId }, data: { channelId: null } });
  }
}
