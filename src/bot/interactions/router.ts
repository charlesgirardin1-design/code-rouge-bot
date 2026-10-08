import type { Interaction } from "discord.js";
import { PERMISSION_LEVEL_NAMES } from "../../permissions/levels.js";
import { memberLevel } from "../permissions/index.js";
import { replyWithError, UserError } from "../errors.js";
import { commandMap } from "../commands/index.js";
import { createComponentHandlers } from "./components.js";
import { childLogger } from "../../utils/logger.js";
import { ExpiringMap } from "../../utils/timeWindow.js";
import type { BotContext, ComponentHandler } from "../types.js";

const log = childLogger("interactions");

/** Limite anti-abus : nombre d'interactions par utilisateur sur 10 secondes. */
const USER_RATE_LIMIT = 8;
const RATE_WINDOW_MS = 10_000;

export function createInteractionRouter(ctx: BotContext) {
  const components: Map<string, ComponentHandler> = createComponentHandlers(ctx);
  const cooldowns = new ExpiringMap<string, number>(10 * 60_000);
  const rate = new ExpiringMap<string, number[]>(RATE_WINDOW_MS);
  setInterval(() => {
    cooldowns.sweep();
    rate.sweep();
  }, 60_000).unref();

  const rateLimited = (userId: string): boolean => {
    const now = Date.now();
    const hits = rate.getOrCreate(userId, () => [], now).filter((t) => now - t < RATE_WINDOW_MS);
    hits.push(now);
    rate.set(userId, hits, now);
    return hits.length > USER_RATE_LIMIT;
  };

  return async function handle(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      if (interaction.isRepliable()) await replyWithError(interaction, new UserError("Les commandes ne sont disponibles que sur un serveur."));
      return;
    }

    // Autocomplétion : pas de réponse d'erreur possible, on renvoie une liste vide.
    if (interaction.isAutocomplete()) {
      const command = commandMap.get(interaction.commandName);
      try {
        await command?.autocomplete?.(interaction, ctx);
      } catch (err) {
        log.debug({ err }, "Échec d'autocomplétion");
        await interaction.respond([]).catch(() => undefined);
      }
      return;
    }

    if (!interaction.isRepliable()) return;
    try {
      if (rateLimited(interaction.user.id)) throw new UserError("Vous effectuez trop d'actions. Patientez quelques secondes.", "Doucement");

      if (interaction.isChatInputCommand()) {
        const command = commandMap.get(interaction.commandName);
        if (!command) throw new UserError("Commande inconnue. Elle a peut-être été retirée.");
        const config = await ctx.config.get(interaction.guildId);
        // Contrôle côté bot, indépendant des permissions Discord affichées.
        const required = typeof command.level === "function" ? command.level(interaction) : command.level;
        const level = memberLevel(interaction.member, config);
        if (level < required) {
          throw new UserError(`Cette commande nécessite le niveau **${PERMISSION_LEVEL_NAMES[required]}** (votre niveau : ${PERMISSION_LEVEL_NAMES[level]}).`, "Permission insuffisante");
        }
        if (command.cooldownSeconds) {
          const key = `${interaction.user.id}:${command.data.name}`;
          const last = cooldowns.get(key);
          if (last && Date.now() - last < command.cooldownSeconds * 1000) {
            throw new UserError(`Patientez ${Math.ceil((command.cooldownSeconds * 1000 - (Date.now() - last)) / 1000)} s avant de réutiliser cette commande.`, "Cooldown");
          }
          cooldowns.set(key, Date.now());
        }
        log.info({ guildId: interaction.guildId, userId: interaction.user.id, command: interaction.commandName, sub: interaction.options.getSubcommand(false) }, "Commande");
        await command.execute(interaction, ctx);
        return;
      }

      if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        const [prefix, ...args] = interaction.customId.split(":");
        const handler = components.get(prefix ?? "");
        if (!handler) return;
        await handler.execute(interaction, ctx, args);
      }
    } catch (err) {
      await replyWithError(interaction, err, {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        id: interaction.isChatInputCommand() ? interaction.commandName : "customId" in interaction ? interaction.customId : interaction.type,
      });
    }
  };
}
