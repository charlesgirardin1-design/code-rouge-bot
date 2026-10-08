import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, type Client, type MessageCreateOptions } from "discord.js";
import { z } from "zod";
import type { Announcement, PrismaClient } from "../../database/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuditService } from "../../services/auditService.js";
import { auditEmbed, type LogService } from "../logs/logService.js";
import { Colors } from "../../bot/ui/embeds.js";
import { describeError, UserError } from "../../bot/errors.js";
import { childLogger } from "../../utils/logger.js";

const log = childLogger("announcements");

const httpsUrl = z.string().trim().url().refine((u) => u.startsWith("https://"), "L'URL doit commencer par https://");

/** Contenu d'une annonce, validé à la création (Discord comme dashboard). */
export const announcementInputSchema = z.object({
  channelId: z.string().regex(/^\d{17,20}$/),
  title: z.string().trim().max(256).nullable().default(null),
  description: z.string().trim().min(1, "La description est obligatoire").max(4000),
  color: z.string().regex(/^#?[0-9a-fA-F]{6}$/, "Couleur hexadécimale attendue (ex. #3B82F6)").nullable().default(null),
  imageUrl: httpsUrl.nullable().default(null),
  thumbnailUrl: httpsUrl.nullable().default(null),
  footer: z.string().trim().max(2048).nullable().default(null),
  author: z.string().trim().max(256).nullable().default(null),
  /** "everyone", "here" ou un ID de rôle */
  mention: z.union([z.enum(["everyone", "here"]), z.string().regex(/^\d{17,20}$/)]).nullable().default(null),
  buttonLabel: z.string().trim().max(80).nullable().default(null),
  buttonUrl: httpsUrl.nullable().default(null),
}).refine((a) => Boolean(a.buttonLabel) === Boolean(a.buttonUrl), { message: "Le bouton nécessite un libellé ET une URL", path: ["buttonUrl"] });

export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export interface StoredEmbed {
  title: string | null;
  description: string;
  color: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  footer: string | null;
  author: string | null;
}

export function buildAnnouncementMessage(a: Pick<Announcement, "embed" | "mention" | "buttonLabel" | "buttonUrl">, canMentionEveryone = true): MessageCreateOptions {
  const e = a.embed as unknown as StoredEmbed;
  const embed = new EmbedBuilder().setDescription(e.description).setColor(e.color ? Number.parseInt(e.color.replace("#", ""), 16) : Colors.info);
  if (e.title) embed.setTitle(e.title);
  if (e.imageUrl) embed.setImage(e.imageUrl);
  if (e.thumbnailUrl) embed.setThumbnail(e.thumbnailUrl);
  if (e.footer) embed.setFooter({ text: e.footer });
  if (e.author) embed.setAuthor({ name: e.author });
  embed.setTimestamp();

  let content: string | undefined;
  const allowedMentions: MessageCreateOptions["allowedMentions"] = { parse: [], roles: [] };
  if (a.mention === "everyone" || a.mention === "here") {
    content = `@${a.mention}`;
    if (canMentionEveryone) allowedMentions.parse = ["everyone"];
  } else if (a.mention) {
    content = `<@&${a.mention}>`;
    allowedMentions.roles = [a.mention];
  }
  const components = a.buttonLabel && a.buttonUrl ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(a.buttonLabel).setURL(a.buttonUrl))] : [];
  return { content, embeds: [embed], components, allowedMentions };
}

export class AnnouncementService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaClient,
    private readonly logs: LogService,
    private readonly audit: AuditService,
  ) {}

  async createDraft(guildId: string, authorId: string, input: AnnouncementInput): Promise<Announcement> {
    const embed: StoredEmbed = {
      title: input.title,
      description: input.description,
      color: input.color ? `#${input.color.replace("#", "")}` : null,
      imageUrl: input.imageUrl,
      thumbnailUrl: input.thumbnailUrl,
      footer: input.footer,
      author: input.author,
    };
    return this.prisma.announcement.create({
      data: {
        guildId,
        channelId: input.channelId,
        authorId,
        embed: embed as unknown as Prisma.InputJsonValue,
        mention: input.mention,
        buttonLabel: input.buttonLabel,
        buttonUrl: input.buttonUrl,
      },
    });
  }

  async get(id: number, guildId: string): Promise<Announcement> {
    const a = await this.prisma.announcement.findFirst({ where: { id, guildId } });
    if (!a) throw new UserError("Annonce introuvable.");
    return a;
  }

  async schedule(id: number, guildId: string, at: Date, actorId: string): Promise<Announcement> {
    const a = await this.get(id, guildId);
    if (a.status !== "DRAFT") throw new UserError("Cette annonce a déjà été traitée.");
    if (at.getTime() < Date.now() - 60_000) throw new UserError("La date de programmation est déjà passée.");
    const updated = await this.prisma.announcement.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: at } });
    await this.audit.record({ guildId, actorId, actorType: "USER", action: "announcement.schedule", targetId: String(id), targetType: "announcement", details: { scheduledAt: at.toISOString() } });
    return updated;
  }

  async cancel(id: number, guildId: string, actorId: string, actorType: "USER" | "DASHBOARD" = "USER"): Promise<void> {
    const res = await this.prisma.announcement.updateMany({ where: { id, guildId, status: { in: ["DRAFT", "SCHEDULED"] } }, data: { status: "CANCELLED" } });
    if (res.count === 0) throw new UserError("Cette annonce ne peut plus être annulée.");
    await this.audit.record({ guildId, actorId, actorType, action: "announcement.cancel", targetId: String(id), targetType: "announcement" });
  }

  /** Publie une annonce. Le passage DRAFT/SCHEDULED → PUBLISHING est atomique (pas de double publication). */
  async publish(id: number, guildId: string, actorId: string): Promise<Announcement> {
    const lock = await this.prisma.announcement.updateMany({ where: { id, guildId, status: { in: ["DRAFT", "SCHEDULED"] } }, data: { status: "PUBLISHING" } });
    if (lock.count === 0) throw new UserError("Cette annonce a déjà été publiée ou annulée.");
    const a = await this.get(id, guildId);
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) throw new UserError("Je ne suis plus sur ce serveur.");
      const channel = guild.channels.cache.get(a.channelId);
      if (!channel?.isTextBased()) throw new UserError("Le salon de l'annonce n'existe plus.");
      const me = guild.members.me!;
      const perms = me.permissionsIn(channel);
      if (!perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        throw new UserError(`Je ne peux pas publier dans ${channel.toString()} (permissions manquantes).`);
      }
      const message = await channel.send(buildAnnouncementMessage(a, perms.has(PermissionFlagsBits.MentionEveryone)));
      const updated = await this.prisma.announcement.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date(), messageId: message.id, error: null } });
      await this.audit.record({ guildId, actorId, actorType: actorId === this.client.user?.id ? "BOT" : "USER", action: "announcement.publish", targetId: String(id), targetType: "announcement", details: { channelId: a.channelId, messageId: message.id } });
      await this.logs.send(guild, "server", {
        embeds: [auditEmbed({ action: "📢 Annonce publiée", actor: `<@${a.authorId}>`, target: channel.toString(), result: `Succès — [voir le message](${message.url})`, color: Colors.success, extra: [{ name: "Annonce", value: `#${id}`, inline: true }] })],
      });
      return updated;
    } catch (err) {
      const message = describeError(err).message;
      await this.prisma.announcement.update({ where: { id }, data: { status: "FAILED", error: message } });
      await this.audit.record({ guildId, actorId, actorType: "BOT", action: "announcement.publish", targetId: String(id), targetType: "announcement", success: false, details: { error: message } });
      throw err;
    }
  }

  start(): void {
    this.timer ??= setInterval(() => void this.processDue(), 30_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Publie les annonces programmées arrivées à échéance. */
  async processDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.prisma.announcement.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } }, take: 20, orderBy: { scheduledAt: "asc" } });
      for (const a of due) {
        if (!this.client.guilds.cache.has(a.guildId)) continue;
        try {
          await this.publish(a.id, a.guildId, this.client.user!.id);
        } catch (err) {
          log.warn({ err: describeError(err).message, id: a.id }, "Échec de publication d'une annonce programmée");
        }
      }
    } finally {
      this.running = false;
    }
  }
}
