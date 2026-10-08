import type { SlashCommand } from "../types.js";
import { moderationCommands } from "./moderation.js";
import { securityCommands } from "./security.js";
import { adminCommands } from "./admin.js";
import { ticketCommands } from "./tickets.js";
import { createHelpCommand, infoCommands } from "./info.js";

const base: SlashCommand[] = [...moderationCommands, ...securityCommands, ...adminCommands, ...ticketCommands, ...infoCommands];
export const commands: SlashCommand[] = [...base, createHelpCommand(() => commands)];

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
