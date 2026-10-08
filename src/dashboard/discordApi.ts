import { REST, Routes, type APIChannel, type APIGuild, type APIGuildMember, type APIRole } from "discord.js";
import { ExpiringMap } from "../utils/timeWindow.js";

const API = "https://discord.com/api/v10";

export interface OAuthUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface OAuthGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

export interface GuildSnapshot {
  id: string;
  name: string;
  icon: string | null;
  ownerId: string;
  roles: Array<{ id: string; name: string; permissions: string; position: number; color: number; managed: boolean }>;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
}

/** Accès à l'API Discord utilisé par le dashboard. Interface injectable pour les tests. */
export interface DiscordApi {
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<{ accessToken: string }>;
  getUser(accessToken: string): Promise<OAuthUser>;
  getUserGuilds(accessToken: string): Promise<OAuthGuild[]>;
  getGuild(guildId: string): Promise<GuildSnapshot | null>;
  getMemberRoles(guildId: string, userId: string): Promise<string[] | null>;
  getChannels(guildId: string): Promise<ChannelInfo[]>;
}

export class DiscordHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function createDiscordApi(opts: { clientId: string; clientSecret: string; botToken: string; redirectUri: string }): DiscordApi {
  const rest = new REST({ version: "10" }).setToken(opts.botToken);
  const guildCache = new ExpiringMap<string, GuildSnapshot | null>(30_000);
  const memberCache = new ExpiringMap<string, string[] | null>(30_000);
  const channelCache = new ExpiringMap<string, ChannelInfo[]>(30_000);

  async function userRequest<T>(path: string, accessToken: string): Promise<T> {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new DiscordHttpError(res.status, `Discord a répondu ${res.status}`);
    return (await res.json()) as T;
  }

  const isNotFound = (err: unknown) => typeof err === "object" && err !== null && "status" in err && (err.status === 404 || err.status === 403);

  return {
    authorizeUrl(state) {
      const url = new URL("https://discord.com/oauth2/authorize");
      url.searchParams.set("client_id", opts.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", opts.redirectUri);
      url.searchParams.set("scope", "identify guilds");
      url.searchParams.set("state", state);
      url.searchParams.set("prompt", "none");
      return url.toString();
    },

    async exchangeCode(code) {
      const res = await fetch(`${API}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: opts.redirectUri,
        }),
      });
      if (!res.ok) throw new DiscordHttpError(res.status, "Échange du code OAuth2 refusé");
      const data = (await res.json()) as { access_token?: string; scope?: string };
      if (!data.access_token || !data.scope?.split(" ").includes("guilds")) throw new DiscordHttpError(400, "Réponse OAuth2 invalide");
      return { accessToken: data.access_token };
    },

    getUser: (token) => userRequest<OAuthUser>("/users/@me", token),
    getUserGuilds: (token) => userRequest<OAuthGuild[]>("/users/@me/guilds", token),

    async getGuild(guildId) {
      const cached = guildCache.get(guildId);
      if (cached !== undefined) return cached;
      try {
        const g = (await rest.get(Routes.guild(guildId))) as APIGuild;
        const snapshot: GuildSnapshot = {
          id: g.id,
          name: g.name,
          icon: g.icon,
          ownerId: g.owner_id,
          roles: (g.roles as APIRole[]).map((r) => ({ id: r.id, name: r.name, permissions: r.permissions, position: r.position, color: r.color, managed: r.managed })),
        };
        guildCache.set(guildId, snapshot);
        return snapshot;
      } catch (err) {
        if (isNotFound(err)) {
          guildCache.set(guildId, null);
          return null;
        }
        throw err;
      }
    },

    async getMemberRoles(guildId, userId) {
      const key = `${guildId}:${userId}`;
      const cached = memberCache.get(key);
      if (cached !== undefined) return cached;
      try {
        const m = (await rest.get(Routes.guildMember(guildId, userId))) as APIGuildMember;
        memberCache.set(key, m.roles);
        return m.roles;
      } catch (err) {
        if (isNotFound(err)) {
          memberCache.set(key, null);
          return null;
        }
        throw err;
      }
    },

    async getChannels(guildId) {
      const cached = channelCache.get(guildId);
      if (cached) return cached;
      const channels = ((await rest.get(Routes.guildChannels(guildId))) as APIChannel[]).map((c) => ({
        id: c.id,
        name: "name" in c && c.name ? c.name : c.id,
        type: c.type,
        parentId: "parent_id" in c ? (c.parent_id ?? null) : null,
        position: "position" in c ? c.position : 0,
      }));
      channelCache.set(guildId, channels);
      return channels;
    },
  };
}
