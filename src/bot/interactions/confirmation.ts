import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
} from "discord.js";
import { errorEmbed, infoEmbed, warningEmbed } from "../ui/embeds.js";
import { attempt, replyWithError } from "../errors.js";
import type { ComponentHandler } from "../types.js";

interface Pending {
  userId: string;
  timer: NodeJS.Timeout;
  onConfirm: (interaction: ButtonInteraction<"cached">) => Promise<void>;
}

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  confirmEmoji?: string;
  danger?: boolean;
  timeoutMs?: number;
  onConfirm: (interaction: ButtonInteraction<"cached">) => Promise<void>;
}

/**
 * Confirmations à deux boutons pour les actions dangereuses.
 * Seul l'auteur de la commande peut répondre ; les boutons expirent automatiquement.
 */
export class ConfirmationService {
  private readonly pending = new Map<string, Pending>();

  async prompt(interaction: ChatInputCommandInteraction<"cached">, opts: ConfirmOptions): Promise<void> {
    const id = randomUUID().slice(0, 18);
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const embed: EmbedBuilder = warningEmbed(`⚠️ CONFIRMATION — ${opts.title}`, opts.description).setFooter({
      text: `Expire dans ${Math.round(timeoutMs / 1000)} secondes`,
    });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm:${id}:yes`)
        .setLabel(opts.confirmLabel ?? "Confirmer")
        .setEmoji(opts.confirmEmoji ?? "✅")
        .setStyle(opts.danger === false ? ButtonStyle.Primary : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`confirm:${id}:no`).setLabel("Annuler").setEmoji("❌").setStyle(ButtonStyle.Secondary),
    );

    const timer = setTimeout(() => {
      if (!this.pending.delete(id)) return;
      void attempt(interaction.editReply({ embeds: [infoEmbed("Confirmation expirée", "Aucune action n'a été effectuée.")], components: [] }));
    }, timeoutMs);
    timer.unref();
    this.pending.set(id, { userId: interaction.user.id, timer, onConfirm: opts.onConfirm });

    const payload = { embeds: [embed], components: [row] };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: "Ephemeral" });
  }

  readonly handler: ComponentHandler = {
    prefix: "confirm",
    execute: async (interaction, _ctx, [id, choice]) => {
      if (!interaction.isButton() || !id) return;
      const entry = this.pending.get(id);
      if (!entry) {
        await interaction.update({ embeds: [infoEmbed("Confirmation expirée", "Relancez la commande si nécessaire.")], components: [] });
        return;
      }
      if (interaction.user.id !== entry.userId) {
        await interaction.reply({ embeds: [errorEmbed("Action refusée", "Seul l'auteur de la commande peut confirmer.")], flags: "Ephemeral" });
        return;
      }
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (choice !== "yes") {
        await interaction.update({ embeds: [infoEmbed("Action annulée", "Aucune action n'a été effectuée.")], components: [] });
        return;
      }
      await interaction.update({ embeds: [infoEmbed("Traitement en cours…")], components: [] });
      try {
        await entry.onConfirm(interaction);
      } catch (err) {
        await replyWithError(interaction, err, { handler: "confirm" });
      }
    },
  };
}
