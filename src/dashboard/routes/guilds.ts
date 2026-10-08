import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getByPath, OWNER_ONLY_CONFIG_PATHS } from "../../config/guildConfig.js";
import { PermissionLevel, PERMISSION_LEVEL_NAMES } from "../../permissions/levels.js";
import { HttpError } from "../errors.js";
import { requireSession } from "../session.js";
import { parseInput, type Deps } from "../server.js";

export const guildParams = z.object({ guildId: z.string().regex(/^\d{17,20}$/) });

const MODULE_KEYS = ["antiRaid", "antiSpam", "antiNuke", "antiPhishing", "antiAlt", "antiBot", "verification", "welcome", "tickets"] as const;

export async function registerGuildRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get("/api/me", async (request) => {
    const session = requireSession(request);
    const known = await deps.prisma.guild.findMany({ where: { id: { in: session.guildIds }, leftAt: null }, select: { id: true } });
    const guilds = [];
    for (const { id } of known) {
      const access = await deps.access.resolve(session.userId, id).catch(() => null);
      if (access && access.level >= PermissionLevel.SUPPORT) {
        guilds.push({ id, name: access.guild.name, icon: access.guild.icon, level: access.level, levelName: PERMISSION_LEVEL_NAMES[access.level] });
      }
    }
    return { user: { id: session.userId, username: session.username, avatar: session.avatar }, guilds };
  });

  app.get("/api/guilds/:guildId/overview", async (request) => {
    const session = requireSession(request);
    const { guildId } = parseInput(guildParams, request.params);
    const access = await deps.access.require(session.userId, guildId, PermissionLevel.SUPPORT);
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [settings, lockdown, stats, events, recent, sanctions, openTickets] = await Promise.all([
      deps.prisma.guildSettings.findUnique({ where: { guildId }, select: { securityScore: true, securityLevel: true, updatedAt: true } }),
      deps.prisma.lockdownState.findUnique({ where: { guildId }, select: { active: true, automatic: true, reason: true, startedAt: true } }),
      deps.prisma.guildStatistics.findUnique({ where: { guildId } }),
      deps.prisma.securityEvent.groupBy({ by: ["type"], where: { guildId, createdAt: { gte: since }, simulated: false }, _count: true }),
      deps.prisma.securityEvent.findMany({ where: { guildId }, orderBy: { createdAt: "desc" }, take: 8 }),
      deps.prisma.moderationAction.count({ where: { guildId, success: true } }),
      deps.prisma.ticket.count({ where: { guildId, status: { in: ["OPEN", "CLAIMED"] } } }),
    ]);
    const config = await deps.configs.get(guildId);
    return {
      guild: { id: guildId, name: access.guild.name, icon: access.guild.icon },
      access: { level: access.level, levelName: PERMISSION_LEVEL_NAMES[access.level] },
      security: {
        score: settings?.securityScore ?? 0,
        level: settings?.securityLevel ?? "NORMAL",
        updatedAt: settings?.updatedAt ?? null,
        thresholds: config.riskEngine.thresholds,
        lockdown: lockdown?.active ? lockdown : null,
        modules: Object.fromEntries(MODULE_KEYS.map((k) => [k, config[k].enabled])),
        last24h: Object.fromEntries(events.map((e) => [e.type, e._count])),
      },
      stats: {
        messagesDeleted: stats?.messagesDeleted ?? 0,
        spamDetected: stats?.spamDetected ?? 0,
        raidsDetected: stats?.raidsDetected ?? 0,
        linksBlocked: stats?.linksBlocked ?? 0,
        nukeDetected: stats?.nukeDetected ?? 0,
        membersVerified: stats?.membersVerified ?? 0,
        sanctions,
        openTickets,
      },
      recentEvents: recent,
    };
  });

  app.get("/api/guilds/:guildId/config", async (request) => {
    const session = requireSession(request);
    const { guildId } = parseInput(guildParams, request.params);
    const access = await deps.access.require(session.userId, guildId, PermissionLevel.ADMIN);
    const [config, channels] = await Promise.all([deps.configs.get(guildId), deps.discord.getChannels(guildId)]);
    return {
      config,
      canEditOwnerOnly: access.level >= PermissionLevel.OWNER,
      ownerOnlyPaths: OWNER_ONLY_CONFIG_PATHS,
      channels: channels.sort((a, b) => a.position - b.position),
      roles: access.guild.roles.filter((r) => r.id !== guildId && !r.managed).sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name, color: r.color })),
    };
  });

  app.put("/api/guilds/:guildId/config", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const session = requireSession(request);
    const { guildId } = parseInput(guildParams, request.params);
    const access = await deps.access.require(session.userId, guildId, PermissionLevel.ADMIN);
    const patch = parseInput(z.record(z.string(), z.unknown()), request.body);
    const current = await deps.configs.get(guildId);

    // Les clés sensibles (rôles admin, utilisateurs de confiance anti-nuke) sont réservées au propriétaire.
    if (access.level < PermissionLevel.OWNER) {
      for (const p of OWNER_ONLY_CONFIG_PATHS) {
        const proposed = getByPath(patch, p);
        if (proposed !== undefined && JSON.stringify(proposed) !== JSON.stringify(getByPath(current, p))) {
          throw new HttpError(403, `Seul le propriétaire du serveur peut modifier « ${p} »`);
        }
      }
    }
    const result = await deps.configs.update(guildId, patch, session.userId);
    if (!result.ok) throw new HttpError(400, "Configuration invalide", result.errors);
    await deps.publish({ type: "config_updated", guildId });
    await deps.audit.record({
      guildId,
      actorId: session.userId,
      actorType: "DASHBOARD",
      action: "config.update",
      targetType: "config",
      details: { sections: Object.keys(patch) },
    });
    return { config: result.config };
  });
}
