import { EmbedBuilder, time, TimestampStyles } from "discord.js";

/** Identité visuelle : 🟢 succès, 🟡 avertissement, 🔴 erreur, 🔵 information, 🟣 sécurité. */
export const Colors = {
  success: 0x22c55e,
  warning: 0xeab308,
  error: 0xef4444,
  info: 0x3b82f6,
  security: 0x8b5cf6,
  neutral: 0x64748b,
} as const;

export const Icons = {
  success: "🟢",
  warning: "🟡",
  error: "🔴",
  info: "🔵",
  security: "🟣",
} as const;

type Kind = keyof typeof Icons;

function base(kind: Kind, title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(Colors[kind]).setTitle(`${Icons[kind]} ${title}`);
  if (description) embed.setDescription(description);
  return embed;
}

export const successEmbed = (title: string, description?: string) => base("success", title, description);
export const warningEmbed = (title: string, description?: string) => base("warning", title, description);
export const errorEmbed = (title: string, description?: string) => base("error", title, description);
export const infoEmbed = (title: string, description?: string) => base("info", title, description);
export const securityEmbed = (title: string, description?: string) => base("security", title, description);

export const discordDate = (date: Date) => `${time(date, TimestampStyles.ShortDateTime)} (${time(date, TimestampStyles.RelativeTime)})`;

export const userLabel = (id: string, tag?: string | null) => (tag ? `<@${id}> (${tag} · \`${id}\`)` : `<@${id}> (\`${id}\`)`);
