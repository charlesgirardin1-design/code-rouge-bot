import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { type z } from "zod";
import type { PrismaClient } from "../database/client.js";
import type { BusEvent } from "../database/notify.js";
import { GuildConfigService } from "../services/guildConfigService.js";
import { ListService } from "../services/listService.js";
import { AuditService } from "../services/auditService.js";
import { logger } from "../utils/logger.js";
import { AccessService } from "./access.js";
import type { DiscordApi } from "./discordApi.js";
import { HttpError } from "./errors.js";
import { SESSION_COOKIE, SessionStore } from "./session.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerGuildRoutes } from "./routes/guilds.js";
import { registerDataRoutes } from "./routes/data.js";

export interface ServerOptions {
  prisma: PrismaClient;
  discord: DiscordApi;
  publish: (event: BusEvent) => Promise<void>;
  dashboardUrl: string;
  sessionSecret: string;
  /** Dossier du frontend compilé (servi en production) */
  staticDir?: string | null;
  logger?: boolean;
}

export interface Deps {
  prisma: PrismaClient;
  discord: DiscordApi;
  publish: (event: BusEvent) => Promise<void>;
  access: AccessService;
  sessions: SessionStore;
  configs: GuildConfigService;
  lists: ListService;
  audit: AuditService;
  dashboardUrl: URL;
  secureCookies: boolean;
}

/** Valide une entrée avec Zod ; lève une erreur 400 lisible. */
export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, "Données invalides", result.error.issues.map((i) => `${i.path.join(".") || "body"} : ${i.message}`));
  }
  return result.data;
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const dashboardUrl = new URL(opts.dashboardUrl);
  const app = Fastify({
    logger: opts.logger ? { level: "info", redact: ["req.headers.cookie", "req.headers.authorization"] } : false,
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  const configs = new GuildConfigService(opts.prisma);
  const deps: Deps = {
    prisma: opts.prisma,
    discord: opts.discord,
    publish: opts.publish,
    access: new AccessService(opts.prisma, opts.discord, configs),
    sessions: new SessionStore(opts.prisma),
    configs,
    lists: new ListService(opts.prisma),
    audit: new AuditService(opts.prisma),
    dashboardUrl,
    secureCookies: dashboardUrl.protocol === "https:",
  };

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "https://cdn.discordapp.com", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie, { secret: opts.sessionSecret });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  // Session : le cookie signé contient un jeton opaque, vérifié en base à chaque requête.
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    request.session = await deps.sessions.find(unsigned.value);
  });

  // Protection CSRF : toute requête modifiante doit provenir de l'origine du dashboard.
  app.addHook("onRequest", async (request) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const origin = request.headers.origin ?? (request.headers.referer ? new URL(request.headers.referer).origin : null);
    if (origin !== dashboardUrl.origin) throw new HttpError(403, "Origine de la requête refusée");
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.message, details: error.details });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: "Trop de requêtes, réessayez dans un instant" });
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: "Requête invalide" });
    logger.error({ err: error, url: request.url, method: request.method }, "Erreur API du dashboard");
    // Aucune information interne (stack, SQL, secrets) n'est renvoyée au client.
    return reply.status(500).send({ error: "Erreur interne du serveur" });
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  await registerAuthRoutes(app, deps);
  await registerGuildRoutes(app, deps);
  await registerDataRoutes(app, deps);

  const staticDir = opts.staticDir === undefined ? defaultStaticDir() : opts.staticDir;
  if (staticDir && existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false });
    // Application monopage : toute route inconnue hors /api et /auth renvoie index.html.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== "GET" || request.url.startsWith("/api") || request.url.startsWith("/auth")) {
        return reply.status(404).send({ error: "Introuvable" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: "Introuvable" }));
  }

  return app;
}

function defaultStaticDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../dashboard/frontend/dist");
}
