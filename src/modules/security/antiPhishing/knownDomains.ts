/**
 * Domaines de phishing connus ciblant Discord / Steam (liste de base intégrée).
 * Cette liste est volontairement courte : elle sert de socle. Chaque serveur complète
 * sa propre blacklist via /blacklist-domain ou le dashboard, et les heuristiques
 * (imitation de domaines officiels, faux Nitro) couvrent les variantes inconnues.
 */
export const BUILTIN_PHISHING_DOMAINS: readonly string[] = [
  "discord-nitro.gift",
  "discord-gift.com",
  "discordgift.site",
  "discord-app.com",
  "discordnitro.info",
  "discord-airdrop.com",
  "discordapp.gift",
  "dlscord.com",
  "dlscord.gift",
  "discorcl.com",
  "disocrd.com",
  "discrod.com",
  "dicsord.com",
  "discordc.com",
  "discord-give.com",
  "nitro-discord.com",
  "free-nitro.com",
  "steamcommunlty.com",
  "steamcomminuty.com",
  "steancommunity.com",
  "stearncommunity.com",
  "steamcommunity-trade.com",
  "steam-gift.ru",
  "grabify.link",
  "iplogger.org",
  "iplogger.com",
  "2no.co",
  "yip.su",
  "blasze.tk",
];
