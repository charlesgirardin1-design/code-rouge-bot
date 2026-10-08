import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { PrismaClient } from "../database/client.js";
import type { PermissionLevel } from "../permissions/levels.js";
import type { GuildConfigService } from "../services/guildConfigService.js";
import type { ListService } from "../services/listService.js";
import type { AuditService } from "../services/auditService.js";
import type { StatsService } from "../services/statsService.js";
import type { LogService } from "../modules/logs/logService.js";
import type { ConfirmationService } from "./interactions/confirmation.js";
import type { ModerationService } from "../modules/moderation/moderationService.js";
import type { SecurityService } from "../modules/security/securityService.js";
import type { LockdownService } from "../modules/lockdown/lockdownService.js";
import type { TicketService } from "../modules/tickets/ticketService.js";
import type { VerificationService } from "../modules/verification/verificationService.js";
import type { AnnouncementService } from "../modules/announcements/announcementService.js";
import type { WelcomeService } from "../modules/welcome/welcomeService.js";

export interface BotContext {
  client: Client<true>;
  prisma: PrismaClient;
  config: GuildConfigService;
  lists: ListService;
  audit: AuditService;
  stats: StatsService;
  logs: LogService;
  confirmations: ConfirmationService;
  moderation: ModerationService;
  security: SecurityService;
  lockdown: LockdownService;
  tickets: TicketService;
  verification: VerificationService;
  announcements: AnnouncementService;
  welcome: WelcomeService;
}

export type CommandCategory = "Modération" | "Sécurité" | "Administration" | "Tickets" | "Informations";

export interface SlashCommand {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  category: CommandCategory;
  /** Niveau minimum requis ; peut dépendre de la sous-commande */
  level: PermissionLevel | ((interaction: ChatInputCommandInteraction<"cached">) => PermissionLevel);
  /** Délai minimum entre deux utilisations par le même utilisateur (secondes) */
  cooldownSeconds?: number;
  execute(interaction: ChatInputCommandInteraction<"cached">, ctx: BotContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction<"cached">, ctx: BotContext): Promise<void>;
}

export type ComponentInteraction = MessageComponentInteraction<"cached"> | ModalSubmitInteraction<"cached">;

/** Gestionnaire de boutons / menus / modals. Le customId suit le format « prefix:arg1:arg2… ». */
export interface ComponentHandler {
  prefix: string;
  execute(interaction: ComponentInteraction, ctx: BotContext, args: string[]): Promise<void>;
}
