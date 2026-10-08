/** Client HTTP du dashboard. Les droits sont toujours vérifiés par l'API, jamais côté navigateur. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`, data.details ?? []);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export type SecurityLevel = "NORMAL" | "SURVEILLANCE" | "REINFORCED" | "LOCKDOWN";

export interface GuildSummary {
  id: string;
  name: string;
  icon: string | null;
  level: number;
  levelName: string;
}

export interface Me {
  user: { id: string; username: string; avatar: string | null };
  guilds: GuildSummary[];
}

export interface SecurityEvent {
  id: number;
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  userId: string | null;
  executorId: string | null;
  level: SecurityLevel;
  actionTaken: string | null;
  simulated: boolean;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface Overview {
  guild: { id: string; name: string; icon: string | null };
  access: { level: number; levelName: string };
  security: {
    score: number;
    level: SecurityLevel;
    thresholds: { surveillance: number; reinforced: number; lockdown: number };
    lockdown: { active: boolean; automatic: boolean; reason: string | null; startedAt: string | null } | null;
    modules: Record<string, boolean>;
    last24h: Record<string, number>;
  };
  stats: Record<string, number>;
  recentEvents: SecurityEvent[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
}

export interface RoleInfo {
  id: string;
  name: string;
  color: number;
}

// La configuration est un objet JSON validé côté serveur (Zod) : typage souple ici.
export type GuildConfig = Record<string, Record<string, unknown>>;

export interface ConfigResponse {
  config: GuildConfig;
  canEditOwnerOnly: boolean;
  ownerOnlyPaths: string[];
  channels: ChannelInfo[];
  roles: RoleInfo[];
}

export const LEVEL_INFO: Record<SecurityLevel, { label: string; emoji: string; tone: string }> = {
  NORMAL: { label: "Serveur sécurisé", emoji: "🟢", tone: "success" },
  SURVEILLANCE: { label: "Surveillance", emoji: "🟡", tone: "warning" },
  REINFORCED: { label: "Sécurité renforcée", emoji: "🟠", tone: "orange" },
  LOCKDOWN: { label: "Lockdown", emoji: "🔴", tone: "danger" },
};

export const PERMISSION = { MEMBER: 0, SUPPORT: 1, MODERATOR: 2, ADMIN: 3, OWNER: 4 } as const;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function guildIconUrl(g: { id: string; icon: string | null }): string | null {
  return g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null;
}
