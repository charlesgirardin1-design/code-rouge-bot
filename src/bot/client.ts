import { Client, GatewayIntentBits, Options, Partials } from "discord.js";

/** Permissions requises par le bot (principe du moindre privilège : pas d'Administrateur). */
export const REQUIRED_PERMISSIONS = [
  "ViewChannel",
  "SendMessages",
  "EmbedLinks",
  "AttachFiles",
  "ReadMessageHistory",
  "ManageMessages",
  "ManageChannels",
  "ManageRoles",
  "ManageGuild",
  "KickMembers",
  "BanMembers",
  "ModerateMembers",
  "ViewAuditLog",
  "MentionEveryone",
] as const;

export function createClient(enablePresence: boolean): Client {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privilégié : arrivées/départs (anti-raid, bienvenue, vérification)
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privilégié : anti-spam, anti-phishing
    GatewayIntentBits.GuildModeration, // bans + journal d'audit (anti-nuke)
  ];
  if (enablePresence) intents.push(GatewayIntentBits.GuildPresences);

  return new Client({
    intents,
    partials: [Partials.GuildMember],
    allowedMentions: { parse: [], repliedUser: false },
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 100,
      ReactionManager: 0,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: { interval: 3600, lifetime: 1800 },
    },
  });
}
