import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { disconnectPrisma, getPrisma } from "../database/client.js";
import { buildServer } from "../dashboard/server.js";
import type { DiscordApi, GuildSnapshot } from "../dashboard/discordApi.js";
import { GuildConfigService } from "../services/guildConfigService.js";
import { DiscordPerm } from "../permissions/levels.js";

/**
 * Tests de l'API du dashboard : vraie base PostgreSQL, API Discord simulée.
 * Vérifie que les permissions sont calculées côté serveur et jamais reprises du client.
 */
const hasDb = Boolean(process.env["DATABASE_URL"]) && process.env["SKIP_DB_TESTS"] !== "1";
const ORIGIN = "http://localhost:5173";
const GUILD = `8${Date.now()}`.padEnd(18, "0").slice(0, 18);
const OWNER = "300000000000000001";
const ADMIN = "300000000000000002";
const MEMBER = "300000000000000003";
const ADMIN_ROLE = "400000000000000001";

const guildSnapshot: GuildSnapshot = {
  id: GUILD,
  name: "Serveur API",
  icon: null,
  ownerId: OWNER,
  roles: [
    { id: GUILD, name: "@everyone", permissions: "0", position: 0, color: 0, managed: false },
    { id: ADMIN_ROLE, name: "Admin", permissions: DiscordPerm.ManageGuild.toString(), position: 5, color: 0, managed: false },
  ],
};

let nextUser = MEMBER;
const fakeDiscord: DiscordApi = {
  authorizeUrl: (state) => `https://discord.com/oauth2/authorize?state=${state}`,
  exchangeCode: vi.fn(async () => ({ accessToken: "fake-access-token" })),
  getUser: vi.fn(async () => ({ id: nextUser, username: `user${nextUser.slice(-1)}`, global_name: null, avatar: null })),
  getUserGuilds: vi.fn(async () => [{ id: GUILD, name: "Serveur API", icon: null, owner: false, permissions: "0" }]),
  getGuild: vi.fn(async (id) => (id === GUILD ? guildSnapshot : null)),
  getMemberRoles: vi.fn(async (_g, userId) => (userId === ADMIN ? [ADMIN_ROLE] : [OWNER, MEMBER].includes(userId) ? [] : null)),
  getChannels: vi.fn(async () => [{ id: "500000000000000001", name: "annonces", type: 0, parentId: null, position: 0 }]),
};

describe.runIf(hasDb)("API du dashboard", () => {
  const prisma = hasDb ? getPrisma() : (null as never);
  const published: unknown[] = [];
  let app: FastifyInstance;

  const sessions = new Map<string, string>();
  async function login(userId: string, fresh = false): Promise<string> {
    if (!fresh && sessions.has(userId)) return sessions.get(userId)!;
    nextUser = userId;
    const start = await app.inject({ method: "GET", url: "/auth/login" });
    const stateCookie = start.cookies.find((c) => c.name === "cr_oauth_state")!;
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    const cb = await app.inject({ method: "GET", url: `/auth/callback?code=abcdefghijkl&state=${state}`, cookies: { cr_oauth_state: stateCookie.value } });
    expect(cb.statusCode).toBe(302);
    const cookie = cb.cookies.find((c) => c.name === "cr_session")!.value;
    sessions.set(userId, cookie);
    return cookie;
  }

  beforeAll(async () => {
    await new GuildConfigService(prisma).ensureGuild({ id: GUILD, name: "Serveur API", ownerId: OWNER });
    app = await buildServer({
      prisma,
      discord: fakeDiscord,
      publish: async (e) => void published.push(e),
      dashboardUrl: ORIGIN,
      sessionSecret: "x".repeat(40),
      staticDir: null,
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.dashboardSession.deleteMany({ where: { userId: { in: [OWNER, ADMIN, MEMBER] } } });
    await prisma.guild.deleteMany({ where: { id: GUILD } });
    await disconnectPrisma();
  });

  it("répond au health check", async () => {
    expect((await app.inject({ url: "/api/health" })).json()).toEqual({ status: "ok" });
  });

  it("refuse l'accès sans session", async () => {
    expect((await app.inject({ url: "/api/me" })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/guilds/${GUILD}/overview` })).statusCode).toBe(401);
  });

  it("refuse un état OAuth2 falsifié", async () => {
    const res = await app.inject({ url: "/auth/callback?code=abcdefghijkl&state=forgedstate123", cookies: {} });
    expect(res.statusCode).toBe(400);
  });

  it("refuse un cookie de session falsifié", async () => {
    const res = await app.inject({ url: "/api/me", cookies: { cr_session: "faux.jeton" } });
    expect(res.statusCode).toBe(401);
  });

  it("un simple membre ne voit pas le serveur et n'y a pas accès", async () => {
    const cookie = await login(MEMBER);
    const me = await app.inject({ url: "/api/me", cookies: { cr_session: cookie } });
    expect(me.json().guilds).toEqual([]);
    expect((await app.inject({ url: `/api/guilds/${GUILD}/overview`, cookies: { cr_session: cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/guilds/${GUILD}/config`, cookies: { cr_session: cookie } })).statusCode).toBe(403);
  });

  it("un administrateur (rôle Gérer le serveur) accède à la configuration", async () => {
    const cookie = await login(ADMIN);
    const me = await app.inject({ url: "/api/me", cookies: { cr_session: cookie } });
    expect(me.json().guilds[0]).toMatchObject({ id: GUILD, levelName: "Administrateur" });
    const cfg = await app.inject({ url: `/api/guilds/${GUILD}/config`, cookies: { cr_session: cookie } });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json().config.antiRaid.lockdownJoins).toBe(30);
    expect(JSON.stringify(cfg.json())).not.toContain(process.env["DATABASE_URL"] ?? "jamais");
  });

  it("bloque les requêtes modifiantes sans origine valide (CSRF)", async () => {
    const cookie = await login(ADMIN);
    const res = await app.inject({ method: "PUT", url: `/api/guilds/${GUILD}/config`, cookies: { cr_session: cookie }, payload: { antiSpam: { warnMessages: 6 } } });
    expect(res.statusCode).toBe(403);
    const evil = await app.inject({ method: "PUT", url: `/api/guilds/${GUILD}/config`, headers: { origin: "https://evil.example" }, cookies: { cr_session: cookie }, payload: {} });
    expect(evil.statusCode).toBe(403);
  });

  it("valide la configuration et notifie le bot", async () => {
    const cookie = await login(ADMIN);
    const bad = await app.inject({ method: "PUT", url: `/api/guilds/${GUILD}/config`, headers: { origin: ORIGIN }, cookies: { cr_session: cookie }, payload: { antiSpam: { warnMessages: 1000 } } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "PUT", url: `/api/guilds/${GUILD}/config`, headers: { origin: ORIGIN }, cookies: { cr_session: cookie }, payload: { antiSpam: { warnMessages: 6 } } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().config.antiSpam.warnMessages).toBe(6);
    expect(published).toContainEqual({ type: "config_updated", guildId: GUILD });
    expect(await prisma.auditLog.count({ where: { guildId: GUILD, actorType: "DASHBOARD", action: "config.update" } })).toBeGreaterThan(0);
  });

  it("réserve les clés sensibles au propriétaire", async () => {
    const adminCookie = await login(ADMIN);
    const patch = { permissions: { adminRoleIds: ["400000000000000009"] } };
    const denied = await app.inject({ method: "PUT", url: `/api/guilds/${GUILD}/config`, headers: { origin: ORIGIN }, cookies: { cr_session: adminCookie }, payload: patch });
    expect(denied.statusCode).toBe(403);
    const ownerCookie = await login(OWNER);
    const allowed = await app.inject({ method: "PUT", url: `/api/guilds/${GUILD}/config`, headers: { origin: ORIGIN }, cookies: { cr_session: ownerCookie }, payload: patch });
    expect(allowed.statusCode).toBe(200);
  });

  it("gère les listes de domaines avec validation", async () => {
    const cookie = await login(ADMIN);
    const headers = { origin: ORIGIN };
    const bad = await app.inject({ method: "POST", url: `/api/guilds/${GUILD}/lists`, headers, cookies: { cr_session: cookie }, payload: { kind: "blacklist", type: "DOMAIN", value: "pas un domaine" } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/api/guilds/${GUILD}/lists`, headers, cookies: { cr_session: cookie }, payload: { kind: "blacklist", type: "DOMAIN", value: "https://www.Evil-Site.com/x" } });
    expect(ok.json().item.value).toBe("evil-site.com");
    const del = await app.inject({ method: "DELETE", url: `/api/guilds/${GUILD}/lists/blacklist/DOMAIN/evil-site.com`, headers, cookies: { cr_session: cookie } });
    expect(del.statusCode).toBe(200);
  });

  it("programme une annonce dans un salon valide uniquement", async () => {
    const cookie = await login(ADMIN);
    const headers = { origin: ORIGIN };
    const wrong = await app.inject({ method: "POST", url: `/api/guilds/${GUILD}/announcements`, headers, cookies: { cr_session: cookie }, payload: { announcement: { channelId: "599999999999999999", description: "Salut" } } });
    expect(wrong.statusCode).toBe(400);
    const everyone = await app.inject({ method: "POST", url: `/api/guilds/${GUILD}/announcements`, headers, cookies: { cr_session: cookie }, payload: { announcement: { channelId: "500000000000000001", description: "Salut", mention: "everyone" } } });
    expect(everyone.statusCode).toBe(403);
    const ok = await app.inject({ method: "POST", url: `/api/guilds/${GUILD}/announcements`, headers, cookies: { cr_session: cookie }, payload: { announcement: { channelId: "500000000000000001", description: "Salut", title: "Info" } } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().item.status).toBe("SCHEDULED");
    const cancel = await app.inject({ method: "DELETE", url: `/api/guilds/${GUILD}/announcements/${ok.json().item.id}`, headers, cookies: { cr_session: cookie } });
    expect(cancel.statusCode).toBe(200);
  });

  it("limite le débit des routes d'authentification", async () => {
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await app.inject({ url: "/auth/login", remoteAddress: "10.9.9.9" })).statusCode);
    expect(codes).toContain(429);
  });

  it("valide les paramètres de requête", async () => {
    const cookie = await login(ADMIN);
    expect((await app.inject({ url: `/api/guilds/${GUILD}/moderation?type=HACK`, cookies: { cr_session: cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/guilds/abc/overview`, cookies: { cr_session: cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/guilds/${GUILD}/moderation?page=2`, cookies: { cr_session: cookie } })).json()).toMatchObject({ page: 2, items: [] });
  });

  it("déconnexion : la session est détruite", async () => {
    const cookie = await login(ADMIN, true);
    await app.inject({ method: "POST", url: "/auth/logout", headers: { origin: ORIGIN }, cookies: { cr_session: cookie } });
    expect((await app.inject({ url: "/api/me", cookies: { cr_session: cookie } })).statusCode).toBe(401);
  });
});
