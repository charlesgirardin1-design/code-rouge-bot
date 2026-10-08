import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PermissionLevel, DiscordPerm } from "../../permissions/levels.js";
import { announcementInputSchema } from "../../modules/announcements/announcementService.js";
import { normalizeHost } from "../../modules/security/antiPhishing/detector.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../errors.js";
import { requireSession } from "../session.js";
import { parseInput, type Deps } from "../server.js";
import { guildParams } from "./guilds.js";

const PAGE_SIZE = 25;
const snowflake = z.string().regex(/^\d{17,20}$/);
const page = z.coerce.number().int().min(1).max(10_000).default(1);

const MODERATION_TYPES = ["BAN", "UNBAN", "KICK", "TIMEOUT", "UNTIMEOUT", "WARN", "CLEAR_WARNINGS", "CLEAR_MESSAGES", "SLOWMODE"] as const;
const EVENT_TYPES = ["RAID", "SPAM", "NUKE", "PHISHING", "ALT", "BOT_ADDED", "LOCKDOWN", "UNLOCK", "LEVEL_CHANGE"] as const;
const TICKET_STATUSES = ["OPEN", "CLAIMED", "CLOSED", "DELETED"] as const;

function paginate(p: number) {
  return { skip: (p - 1) * PAGE_SIZE, take: PAGE_SIZE };
}

export async function registerDataRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** Authentifie la requête et vérifie le niveau requis sur le serveur ciblé. */
  const guard = async (request: { params: unknown; session: unknown } & Parameters<typeof requireSession>[0], level: PermissionLevel) => {
    const session = requireSession(request);
    const { guildId } = parseInput(guildParams, request.params);
    const access = await deps.access.require(session.userId, guildId, level);
    return { session, guildId, access };
  };

  // ─── Modération ───────────────────────────────────────────

  app.get("/api/guilds/:guildId/moderation", async (request) => {
    const { guildId } = await guard(request, PermissionLevel.MODERATOR);
    const q = parseInput(z.object({ page, type: z.enum(MODERATION_TYPES).optional(), userId: snowflake.optional() }), request.query);
    const where: Prisma.ModerationActionWhereInput = { guildId, ...(q.type ? { type: q.type } : {}), ...(q.userId ? { targetId: q.userId } : {}) };
    const [items, total] = await Promise.all([
      deps.prisma.moderationAction.findMany({ where, orderBy: { createdAt: "desc" }, ...paginate(q.page) }),
      deps.prisma.moderationAction.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: PAGE_SIZE };
  });

  app.get("/api/guilds/:guildId/warnings", async (request) => {
    const { guildId } = await guard(request, PermissionLevel.MODERATOR);
    const q = parseInput(z.object({ page, userId: snowflake.optional(), active: z.enum(["true", "false"]).optional() }), request.query);
    const where: Prisma.WarningWhereInput = { guildId, ...(q.userId ? { userId: q.userId } : {}), ...(q.active ? { active: q.active === "true" } : {}) };
    const [items, total] = await Promise.all([
      deps.prisma.warning.findMany({ where, orderBy: { createdAt: "desc" }, include: { user: { select: { username: true } } }, ...paginate(q.page) }),
      deps.prisma.warning.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: PAGE_SIZE };
  });

  // ─── Sécurité ─────────────────────────────────────────────

  app.get("/api/guilds/:guildId/security/events", async (request) => {
    const { guildId } = await guard(request, PermissionLevel.MODERATOR);
    const q = parseInput(z.object({ page, type: z.enum(EVENT_TYPES).optional() }), request.query);
    const where: Prisma.SecurityEventWhereInput = { guildId, ...(q.type ? { type: q.type } : {}) };
    const [items, total] = await Promise.all([
      deps.prisma.securityEvent.findMany({ where, orderBy: { createdAt: "desc" }, ...paginate(q.page) }),
      deps.prisma.securityEvent.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: PAGE_SIZE };
  });

  app.get("/api/guilds/:guildId/lists", async (request) => {
    const { guildId } = await guard(request, PermissionLevel.MODERATOR);
    const [whitelist, blacklist] = await Promise.all([
      deps.prisma.whitelist.findMany({ where: { guildId }, orderBy: { createdAt: "desc" } }),
      deps.prisma.blacklist.findMany({ where: { guildId }, orderBy: { createdAt: "desc" } }),
    ]);
    return { whitelist, blacklist };
  });

  const listBody = z.object({
    kind: z.enum(["whitelist", "blacklist"]),
    type: z.enum(["DOMAIN", "INVITE"]),
    value: z.string().trim().min(2).max(200),
    reason: z.string().trim().max(200).nullable().optional(),
  });

  const normalizeListValue = (type: "DOMAIN" | "INVITE", value: string): string => {
    if (type === "DOMAIN") {
      const host = normalizeHost(value);
      if (!host) throw new HttpError(400, "Domaine invalide");
      return host;
    }
    const code = value.replace(/^(https?:\/\/)?(www\.)?(discord\.gg|discord(app)?\.com\/invite)\//i, "").toLowerCase();
    if (!/^[a-z0-9-]{2,32}$/.test(code)) throw new HttpError(400, "Code d'invitation invalide");
    return code;
  };

  app.post("/api/guilds/:guildId/lists", async (request) => {
    const { guildId, session } = await guard(request, PermissionLevel.ADMIN);
    const body = parseInput(listBody, request.body);
    if (body.kind === "blacklist" && body.type === "INVITE") throw new HttpError(400, "Les invitations sont bloquées par défaut : seule la liste blanche s'applique");
    const value = normalizeListValue(body.type, body.value);
    const row = await deps.lists.add(body.kind, guildId, body.type, value, session.userId, body.reason ?? null);
    await deps.publish({ type: "lists_updated", guildId });
    await deps.audit.record({ guildId, actorId: session.userId, actorType: "DASHBOARD", action: `${body.kind}.add`, targetId: value, targetType: body.type.toLowerCase() });
    return { item: row };
  });

  app.delete("/api/guilds/:guildId/lists/:kind/:type/:value", async (request) => {
    const { guildId, session } = await guard(request, PermissionLevel.ADMIN);
    const p = parseInput(guildParams.extend({ kind: z.enum(["whitelist", "blacklist"]), type: z.enum(["DOMAIN", "INVITE"]), value: z.string().min(2).max(200) }), request.params);
    const removed = await deps.lists.remove(p.kind, guildId, p.type, p.value);
    if (!removed) throw new HttpError(404, "Entrée introuvable");
    await deps.publish({ type: "lists_updated", guildId });
    await deps.audit.record({ guildId, actorId: session.userId, actorType: "DASHBOARD", action: `${p.kind}.remove`, targetId: p.value, targetType: p.type.toLowerCase() });
    return { ok: true };
  });

  // ─── Journal d'audit ──────────────────────────────────────

  app.get("/api/guilds/:guildId/audit-logs", async (request) => {
    const { guildId } = await guard(request, PermissionLevel.ADMIN);
    const q = parseInput(z.object({ page, action: z.string().max(60).regex(/^[a-z_.]+$/).optional() }), request.query);
    const where: Prisma.AuditLogWhereInput = { guildId, ...(q.action ? { action: { startsWith: q.action } } : {}) };
    const [items, total] = await Promise.all([
      deps.prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, ...paginate(q.page) }),
      deps.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: PAGE_SIZE };
  });

  // ─── Tickets ──────────────────────────────────────────────

  app.get("/api/guilds/:guildId/tickets", async (request) => {
    const { guildId } = await guard(request, PermissionLevel.SUPPORT);
    const q = parseInput(z.object({ page, status: z.enum(TICKET_STATUSES).optional() }), request.query);
    const where: Prisma.TicketWhereInput = { guildId, ...(q.status ? { status: q.status } : {}) };
    const [items, total] = await Promise.all([
      deps.prisma.ticket.findMany({ where, orderBy: { createdAt: "desc" }, omit: { transcript: true }, include: { _count: { select: { messages: true } } }, ...paginate(q.page) }),
      deps.prisma.ticket.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: PAGE_SIZE };
  });

  app.get("/api/guilds/:guildId/tickets/:ticketId", async (request) => {
    const { guildId } = await guard(request, PermissionLevel.SUPPORT);
    const { ticketId } = parseInput(z.object({ ticketId: z.coerce.number().int().positive() }), request.params);
    const ticket = await deps.prisma.ticket.findFirst({
      where: { id: ticketId, guildId },
      omit: { transcript: true },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 2000 } },
    });
    if (!ticket) throw new HttpError(404, "Ticket introuvable");
    return { ticket };
  });

  app.get("/api/guilds/:guildId/tickets/:ticketId/transcript", async (request, reply) => {
    const { guildId } = await guard(request, PermissionLevel.SUPPORT);
    const { ticketId } = parseInput(z.object({ ticketId: z.coerce.number().int().positive() }), request.params);
    const ticket = await deps.prisma.ticket.findFirst({ where: { id: ticketId, guildId }, select: { number: true, transcript: true } });
    if (!ticket?.transcript) throw new HttpError(404, "Transcript indisponible (ticket non fermé)");
    // Le transcript est servi isolé (sandbox, aucun script autorisé).
    return reply
      .header("Content-Type", "text/html; charset=utf-8")
      .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src https:; sandbox")
      .header("Content-Disposition", `inline; filename="ticket-${ticket.number}.html"`)
      .send(ticket.transcript);
  });

  // ─── Annonces ─────────────────────────────────────────────

  app.get("/api/guilds/:guildId/announcements", async (request) => {
    const { guildId } = await guard(request, PermissionLevel.ADMIN);
    const q = parseInput(z.object({ page }), request.query);
    const where = { guildId };
    const [items, total] = await Promise.all([
      deps.prisma.announcement.findMany({ where, orderBy: { createdAt: "desc" }, ...paginate(q.page) }),
      deps.prisma.announcement.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: PAGE_SIZE };
  });

  const announcementBody = z.object({
    announcement: z.unknown(),
    /** ISO 8601 ; absent = publication immédiate */
    scheduledAt: z.string().datetime().nullable().optional(),
  });

  app.post("/api/guilds/:guildId/announcements", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const { guildId, session, access } = await guard(request, PermissionLevel.ADMIN);
    const body = parseInput(announcementBody, request.body);
    const input = parseInput(announcementInputSchema, body.announcement);

    const channels = await deps.discord.getChannels(guildId);
    const channel = channels.find((c) => c.id === input.channelId);
    if (!channel || ![0, 5].includes(channel.type)) throw new HttpError(400, "Salon de publication invalide");
    if (input.mention && /^\d+$/.test(input.mention) && !access.guild.roles.some((r) => r.id === input.mention)) throw new HttpError(400, "Rôle de mention introuvable");
    const canMentionEveryone = (access.permissions & (DiscordPerm.MentionEveryone | DiscordPerm.Administrator)) !== 0n || access.level >= PermissionLevel.OWNER;
    if ((input.mention === "everyone" || input.mention === "here") && !canMentionEveryone) throw new HttpError(403, "Vous n'avez pas la permission de mentionner @everyone / @here");

    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : new Date();
    if (scheduledAt.getTime() < Date.now() - 60_000) throw new HttpError(400, "La date de programmation est déjà passée");

    const embed = { title: input.title, description: input.description, color: input.color ? `#${input.color.replace("#", "")}` : null, imageUrl: input.imageUrl, thumbnailUrl: input.thumbnailUrl, footer: input.footer, author: input.author };
    const created = await deps.prisma.announcement.create({
      data: {
        guildId,
        channelId: input.channelId,
        authorId: session.userId,
        embed,
        mention: input.mention,
        buttonLabel: input.buttonLabel,
        buttonUrl: input.buttonUrl,
        status: "SCHEDULED",
        scheduledAt,
      },
    });
    // Le bot publie l'annonce (immédiatement via LISTEN/NOTIFY, sinon à l'échéance).
    await deps.publish({ type: "announcement_scheduled", guildId, announcementId: created.id });
    await deps.audit.record({ guildId, actorId: session.userId, actorType: "DASHBOARD", action: "announcement.schedule", targetId: String(created.id), targetType: "announcement", details: { scheduledAt: scheduledAt.toISOString() } });
    return { item: created };
  });

  app.delete("/api/guilds/:guildId/announcements/:announcementId", async (request) => {
    const { guildId, session } = await guard(request, PermissionLevel.ADMIN);
    const { announcementId } = parseInput(z.object({ announcementId: z.coerce.number().int().positive() }), request.params);
    const res = await deps.prisma.announcement.updateMany({ where: { id: announcementId, guildId, status: { in: ["DRAFT", "SCHEDULED"] } }, data: { status: "CANCELLED" } });
    if (res.count === 0) throw new HttpError(409, "Cette annonce ne peut plus être annulée");
    await deps.audit.record({ guildId, actorId: session.userId, actorType: "DASHBOARD", action: "announcement.cancel", targetId: String(announcementId), targetType: "announcement" });
    return { ok: true };
  });
}
