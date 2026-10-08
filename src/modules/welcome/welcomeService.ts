import { EmbedBuilder, type GuildMember } from "discord.js";
import type { GuildConfigService } from "../../services/guildConfigService.js";
import { renderTemplate } from "../../utils/text.js";
import { childLogger } from "../../utils/logger.js";

const log = childLogger("welcome");

export function welcomeVariables(member: GuildMember): Record<string, string | number> {
  return {
    user: member.toString(),
    username: member.user.username,
    server: member.guild.name,
    memberCount: member.guild.memberCount,
  };
}

export class WelcomeService {
  constructor(private readonly configs: GuildConfigService) {}

  async onJoin(member: GuildMember): Promise<void> {
    const config = await this.configs.get(member.guild.id);
    const w = config.welcome;
    if (!w.enabled || !w.channelId || member.user.bot) return;
    const channel = member.guild.channels.cache.get(w.channelId);
    if (!channel?.isTextBased()) return;
    const text = renderTemplate(w.message, welcomeVariables(member));
    try {
      if (w.useEmbed) {
        const embed = new EmbedBuilder()
          .setColor(Number.parseInt(w.embedColor.slice(1), 16))
          .setAuthor({ name: member.guild.name, iconURL: member.guild.iconURL() ?? undefined })
          .setDescription(text)
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .setTimestamp();
        await channel.send({ content: member.toString(), embeds: [embed], allowedMentions: { users: [member.id] } });
      } else {
        await channel.send({ content: text, allowedMentions: { users: [member.id] } });
      }
    } catch (err) {
      log.warn({ err, guildId: member.guild.id }, "Impossible d'envoyer le message de bienvenue");
    }
  }
}
