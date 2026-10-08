import type { ChatInputCommandInteraction, GuildMember, RepliableInteraction } from "discord.js";
import type { Actor } from "../../modules/moderation/moderationService.js";
import { UserError } from "../errors.js";
import { errorEmbed, successEmbed } from "../ui/embeds.js";
import type { EmbedBuilder } from "discord.js";

export function actorOf(interaction: { user: { id: string; tag: string } }): Actor {
  return { id: interaction.user.id, tag: interaction.user.tag };
}

export function reasonOf(interaction: ChatInputCommandInteraction<"cached">, required = false): string | null {
  const reason = interaction.options.getString("raison", required)?.trim() || null;
  return reason ? reason.slice(0, 500) : null;
}

/** Membre ciblé ; lève une erreur claire si l'utilisateur n'est pas sur le serveur. */
export function requireMember(interaction: ChatInputCommandInteraction<"cached">, option = "membre"): GuildMember {
  const member = interaction.options.getMember(option);
  if (!member) throw new UserError("Ce membre est introuvable sur le serveur.");
  return member;
}

export async function reply(interaction: RepliableInteraction, embed: EmbedBuilder, ephemeral = true): Promise<void> {
  const payload = { embeds: [embed], components: [] };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.reply({ ...payload, ...(ephemeral ? { flags: "Ephemeral" as const } : {}) });
}

export const ok = (title: string, description?: string) => successEmbed(title, description);
export const fail = (title: string, description?: string) => errorEmbed(title, description);
