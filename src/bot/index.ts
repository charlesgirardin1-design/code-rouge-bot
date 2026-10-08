import { Events } from "discord.js";
import { loadBotEnv } from "../config/env.js";
import { disconnectPrisma, getPrisma } from "../database/client.js";
import { subscribeEvents } from "../database/notify.js";
import { logger } from "../utils/logger.js";
import { GuildConfigService } from "../services/guildConfigService.js";
import { ListService } from "../services/listService.js";
import { AuditService } from "../services/auditService.js";
import { StatsService } from "../services/statsService.js";
import { LogService } from "../modules/logs/logService.js";
import { ModerationService } from "../modules/moderation/moderationService.js";
import { LockdownService } from "../modules/lockdown/lockdownService.js";
import { SecurityService } from "../modules/security/securityService.js";
import { VerificationService } from "../modules/verification/verificationService.js";
import { WelcomeService } from "../modules/welcome/welcomeService.js";
import { TicketService } from "../modules/tickets/ticketService.js";
import { AnnouncementService } from "../modules/announcements/announcementService.js";
import { ConfirmationService } from "./interactions/confirmation.js";
import { createClient } from "./client.js";
import { registerEvents, syncAllGuilds } from "./events/register.js";
import { deployCommands } from "./scripts/deployCommands.js";
import type { BotContext } from "./types.js";

async function main(): Promise<void> {
  const env = loadBotEnv();
  const prisma = getPrisma();
  await prisma.$queryRaw`SELECT 1`; // échoue immédiatement si la base est inaccessible

  const client = createClient(env.ENABLE_PRESENCE_INTENT);
  const config = new GuildConfigService(prisma);
  const lists = new ListService(prisma);
  const audit = new AuditService(prisma);
  const stats = new StatsService(prisma);
  const logs = new LogService(client, config);
  const moderation = new ModerationService(client, prisma, config, logs, audit);
  const lockdown = new LockdownService(prisma, config, logs, audit);
  const security = new SecurityService(client, prisma, config, lists, logs, audit, stats, moderation, lockdown);
  const ctx: BotContext = {
    client: client as BotContext["client"],
    prisma,
    config,
    lists,
    audit,
    stats,
    logs,
    confirmations: new ConfirmationService(),
    moderation,
    security,
    lockdown,
    tickets: new TicketService(prisma, config, logs, audit),
    verification: new VerificationService(prisma, config, lockdown, logs, stats, audit),
    announcements: new AnnouncementService(client, prisma, logs, audit),
    welcome: new WelcomeService(config),
  };

  client.once(Events.ClientReady, async (ready) => {
    logger.info({ tag: ready.user.tag, guilds: ready.guilds.cache.size }, "Bot connecté");
    try {
      await syncAllGuilds(ready, ctx);
      await lockdown.loadActive();
      await security.restoreScores([...ready.guilds.cache.keys()]);
      if (env.DEV_GUILD_ID) await deployCommands(env, env.DEV_GUILD_ID);
    } catch (err) {
      logger.error({ err }, "Erreur pendant l'initialisation");
    }
    registerEvents(ready, ctx);
    stats.start();
    security.start();
    ctx.announcements.start();
    void ctx.announcements.processDue();
    const banTimer = setInterval(() => void moderation.processExpiredBans().catch((err: unknown) => logger.error({ err }, "Bans temporaires")), 60_000);
    banTimer.unref();
  });

  const unsubscribe = subscribeEvents((event) => {
    switch (event.type) {
      case "config_updated":
        config.invalidate(event.guildId);
        break;
      case "lists_updated":
        lists.invalidate(event.guildId);
        break;
      case "announcement_scheduled":
        void ctx.announcements.processDue();
        break;
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Arrêt en cours…");
    security.stop();
    ctx.announcements.stop();
    await stats.stop();
    await unsubscribe();
    await client.destroy();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await client.login(env.DISCORD_TOKEN);
}

process.on("unhandledRejection", (err) => logger.error({ err }, "Promesse rejetée non gérée"));
process.on("uncaughtException", (err) => logger.fatal({ err }, "Exception non interceptée"));

main().catch((err: unknown) => {
  logger.fatal({ err }, "Démarrage impossible");
  process.exit(1);
});
