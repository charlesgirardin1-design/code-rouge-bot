import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { HttpError } from "../errors.js";
import { clearCookies, cookieOptions, randomToken, safeEqual, SESSION_COOKIE, SESSION_TTL_MS, STATE_COOKIE } from "../session.js";
import { parseInput, type Deps } from "../server.js";

const callbackQuery = z.object({
  code: z.string().min(10).max(200).optional(),
  state: z.string().min(10).max(200),
  error: z.string().max(100).optional(),
});

export async function registerAuthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const strictLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.get("/auth/login", strictLimit, async (_request, reply) => {
    const state = randomToken(24);
    reply.setCookie(STATE_COOKIE, state, cookieOptions(deps.secureCookies, 600));
    return reply.redirect(deps.discord.authorizeUrl(state));
  });

  app.get("/auth/callback", strictLimit, async (request, reply) => {
    const query = parseInput(callbackQuery, request.query);
    const rawState = request.cookies[STATE_COOKIE];
    const stored = rawState ? request.unsignCookie(rawState) : null;
    reply.clearCookie(STATE_COOKIE, { path: "/" });
    // Protection contre la falsification de requête OAuth2 (paramètre state).
    if (!stored?.valid || !stored.value || !safeEqual(stored.value, query.state)) {
      throw new HttpError(400, "État OAuth2 invalide ou expiré. Recommencez la connexion.");
    }
    if (query.error || !query.code) return reply.redirect("/?error=access_denied");

    try {
      const { accessToken } = await deps.discord.exchangeCode(query.code);
      const [user, guilds] = await Promise.all([deps.discord.getUser(accessToken), deps.discord.getUserGuilds(accessToken)]);
      // Le jeton OAuth2 n'est pas conservé : seule la liste des serveurs de l'utilisateur l'est.
      const token = await deps.sessions.create({
        userId: user.id,
        username: user.global_name ?? user.username,
        avatar: user.avatar,
        guildIds: guilds.map((g) => g.id).slice(0, 500),
      });
      reply.setCookie(SESSION_COOKIE, token, cookieOptions(deps.secureCookies, SESSION_TTL_MS / 1000));
      logger.info({ userId: user.id }, "Connexion au dashboard");
      return reply.redirect("/");
    } catch (err) {
      logger.warn({ err }, "Échec de la connexion OAuth2");
      return reply.redirect("/?error=oauth_failed");
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    if (unsigned?.valid && unsigned.value) await deps.sessions.destroy(unsigned.value);
    clearCookies(reply, deps.secureCookies);
    return { ok: true };
  });
}
