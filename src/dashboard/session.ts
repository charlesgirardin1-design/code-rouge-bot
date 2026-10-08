import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DashboardSession, PrismaClient } from "../database/client.js";
import { HttpError } from "./errors.js";

export const SESSION_COOKIE = "cr_session";
export const STATE_COOKIE = "cr_oauth_state";
export const SESSION_TTL_MS = 7 * 24 * 3_600_000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

declare module "fastify" {
  interface FastifyRequest {
    session: DashboardSession | null;
  }
}

export class SessionStore {
  constructor(private readonly prisma: PrismaClient) {}

  /** Crée une session ; seul le haché du jeton est stocké en base. */
  async create(data: { userId: string; username: string; avatar: string | null; guildIds: string[] }): Promise<string> {
    const token = randomToken();
    await this.prisma.dashboardSession.create({ data: { id: hashToken(token), ...data, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
    return token;
  }

  async find(token: string): Promise<DashboardSession | null> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const session = await this.prisma.dashboardSession.findUnique({ where: { id: hashToken(token) } });
    if (!session || session.expiresAt.getTime() < Date.now()) return null;
    return session;
  }

  async destroy(token: string): Promise<void> {
    await this.prisma.dashboardSession.deleteMany({ where: { id: hashToken(token) } });
  }

  async purgeExpired(): Promise<number> {
    const res = await this.prisma.dashboardSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return res.count;
  }
}

export function requireSession(request: FastifyRequest): DashboardSession {
  if (!request.session) throw new HttpError(401, "Authentification requise");
  return request.session;
}

export function cookieOptions(secure: boolean, maxAgeSeconds: number) {
  return { path: "/", httpOnly: true, secure, sameSite: "lax" as const, signed: true, maxAge: maxAgeSeconds };
}

export function clearCookies(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, secure, sameSite: "lax" });
}
