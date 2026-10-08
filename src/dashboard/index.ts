import { loadDashboardEnv } from "../config/env.js";
import { disconnectPrisma, getPrisma } from "../database/client.js";
import { publishEvent } from "../database/notify.js";
import { logger } from "../utils/logger.js";
import { createDiscordApi } from "./discordApi.js";
import { buildServer } from "./server.js";
import { SessionStore } from "./session.js";

async function main(): Promise<void> {
  const env = loadDashboardEnv();
  const prisma = getPrisma();
  await prisma.$queryRaw`SELECT 1`;

  const discord = createDiscordApi({
    clientId: env.CLIENT_ID,
    clientSecret: env.CLIENT_SECRET,
    botToken: env.DISCORD_TOKEN,
    redirectUri: new URL("/auth/callback", env.DASHBOARD_URL).toString(),
  });
  const app = await buildServer({ prisma, discord, publish: publishEvent, dashboardUrl: env.DASHBOARD_URL, sessionSecret: env.SESSION_SECRET, logger: env.NODE_ENV !== "test" });

  const sessions = new SessionStore(prisma);
  const purge = setInterval(() => void sessions.purgeExpired().catch((err: unknown) => logger.error({ err }, "Purge des sessions")), 3_600_000);
  purge.unref();

  const shutdown = async () => {
    await app.close();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await app.listen({ port: env.DASHBOARD_PORT, host: "0.0.0.0" });
  logger.info({ port: env.DASHBOARD_PORT }, "API du dashboard démarrée");
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "Démarrage du dashboard impossible");
  process.exit(1);
});
