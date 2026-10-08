import { DiscordAPIError, RESTJSONErrorCodes, type RepliableInteraction } from "discord.js";
import { errorEmbed } from "./ui/embeds.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("errors");

/** Erreur destinée à l'utilisateur : son message est affiché tel quel, sans log d'erreur. */
export class UserError extends Error {
  constructor(message: string, readonly title = "Action impossible") {
    super(message);
    this.name = "UserError";
  }
}

const API_MESSAGES: Partial<Record<number, string>> = {
  [RESTJSONErrorCodes.MissingPermissions]: "Je n'ai pas les permissions nécessaires pour effectuer cette action (vérifiez mes rôles et la hiérarchie).",
  [RESTJSONErrorCodes.MissingAccess]: "Je n'ai pas accès à ce salon ou à cette ressource.",
  [RESTJSONErrorCodes.UnknownMember]: "Ce membre est introuvable sur le serveur.",
  [RESTJSONErrorCodes.UnknownUser]: "Utilisateur introuvable.",
  [RESTJSONErrorCodes.UnknownChannel]: "Ce salon n'existe plus.",
  [RESTJSONErrorCodes.UnknownRole]: "Ce rôle n'existe plus.",
  [RESTJSONErrorCodes.UnknownMessage]: "Ce message n'existe plus.",
  [RESTJSONErrorCodes.UnknownBan]: "Cet utilisateur n'est pas banni.",
  [RESTJSONErrorCodes.UnknownInteraction]: "L'interaction a expiré. Veuillez réessayer.",
  [RESTJSONErrorCodes.CannotSendMessagesToThisUser]: "Impossible d'envoyer un message privé à cet utilisateur.",
  [RESTJSONErrorCodes.OneOfTheMessagesProvidedWasTooOldForBulkDelete]: "Discord n'autorise la suppression groupée que pour les messages de moins de 14 jours.",
  [RESTJSONErrorCodes.MaximumNumberOfGuildChannelsReached]: "Le nombre maximum de salons est atteint.",
};

/** Convertit n'importe quelle erreur en message lisible pour un modérateur. */
export function describeError(err: unknown): { message: string; expected: boolean } {
  if (err instanceof UserError) return { message: err.message, expected: true };
  if (err instanceof DiscordAPIError) {
    const known = API_MESSAGES[Number(err.code)];
    if (known) return { message: known, expected: true };
    return { message: `Erreur de l'API Discord (code ${err.code}).`, expected: false };
  }
  if (err && typeof err === "object" && "name" in err && String(err.name).startsWith("PrismaClient")) {
    return { message: "Erreur de base de données. L'action n'a pas pu être enregistrée, réessayez dans un instant.", expected: false };
  }
  return { message: "Une erreur inattendue est survenue. Elle a été enregistrée dans les logs techniques.", expected: false };
}

export function isExpiredInteraction(err: unknown): boolean {
  return err instanceof DiscordAPIError && (err.code === RESTJSONErrorCodes.UnknownInteraction || err.code === RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged);
}

/** Répond à l'interaction avec un message d'erreur, quel que soit son état (répondue, différée…). */
export async function replyWithError(interaction: RepliableInteraction, err: unknown, context: Record<string, unknown> = {}): Promise<void> {
  const { message, expected } = describeError(err);
  if (!expected) log.error({ err, ...context }, "Erreur lors du traitement d'une interaction");
  const title = err instanceof UserError ? err.title : "Erreur";
  const payload = { embeds: [errorEmbed(title, message)], components: [] };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: "Ephemeral" });
  } catch (replyErr) {
    if (!isExpiredInteraction(replyErr)) log.warn({ err: replyErr }, "Impossible de répondre à l'interaction");
  }
}

/** Exécute une promesse en ignorant les erreurs (opérations « best effort » : MP, suppression…). */
export async function attempt<T>(promise: Promise<T> | (() => Promise<T>)): Promise<T | null> {
  try {
    return await (typeof promise === "function" ? promise() : promise);
  } catch {
    return null;
  }
}
