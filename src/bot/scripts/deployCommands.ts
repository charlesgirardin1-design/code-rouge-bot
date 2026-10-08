import { REST, Routes } from "discord.js";
import { pathToFileURL } from "node:url";
import { loadBotEnv, type BotEnv } from "../../config/env.js";
import { commands } from "../commands/index.js";
import { logger } from "../../utils/logger.js";

/** Enregistre les commandes slash : sur un serveur (instantané) ou globalement (propagation jusqu'à 1 h). */
export async function deployCommands(env: Pick<BotEnv, "DISCORD_TOKEN" | "CLIENT_ID">, guildId?: string): Promise<number> {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  const body = commands.map((c) => c.data);
  const route = guildId ? Routes.applicationGuildCommands(env.CLIENT_ID, guildId) : Routes.applicationCommands(env.CLIENT_ID);
  await rest.put(route, { body });
  logger.info({ count: body.length, scope: guildId ? `serveur ${guildId}` : "global" }, "Commandes enregistrées");
  return body.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const env = loadBotEnv();
  const global = process.argv.includes("--global");
  deployCommands(env, global ? undefined : env.DEV_GUILD_ID)
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error({ err }, "Échec de l'enregistrement des commandes");
      process.exit(1);
    });
}
