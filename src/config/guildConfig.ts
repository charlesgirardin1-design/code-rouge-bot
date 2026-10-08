import { z } from "zod";

/**
 * Configuration propre à chaque serveur. Stockée en JSON dans GuildSettings.config,
 * toujours validée par ce schéma (bot, dashboard, import /config).
 * Chaque champ a une valeur par défaut : un serveur sans configuration est fonctionnel.
 */

const snowflake = z.string().regex(/^\d{17,20}$/, "ID Discord invalide");
const optionalSnowflake = snowflake.nullable().default(null);
const snowflakeList = z.array(snowflake).max(50).default([]);
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z0-9-]{2,63}$/, "domaine invalide");

export const SANCTION_ACTIONS = ["none", "timeout", "kick", "ban"] as const;

const warnThresholdSchema = z.object({
  count: z.number().int().min(1).max(50),
  action: z.enum(SANCTION_ACTIONS),
  /** Durée en minutes pour un timeout (max 28 jours) */
  durationMinutes: z.number().int().min(1).max(40320).nullable().default(null),
});

export const guildConfigSchema = z.object({
  permissions: z
    .object({
      adminRoleIds: snowflakeList,
      moderatorRoleIds: snowflakeList,
      supportRoleIds: snowflakeList,
    })
    .prefault({}),

  logs: z
    .object({
      moderationChannelId: optionalSnowflake,
      membersChannelId: optionalSnowflake,
      securityChannelId: optionalSnowflake,
      serverChannelId: optionalSnowflake,
      ticketsChannelId: optionalSnowflake,
      /** Rôles mentionnés lors d'une alerte de sécurité critique */
      alertRoleIds: snowflakeList,
      /** Envoie aussi les alertes critiques en MP au propriétaire du serveur */
      dmOwnerOnCritical: z.boolean().default(true),
    })
    .prefault({}),

  moderation: z
    .object({
      confirmBan: z.boolean().default(true),
      confirmKick: z.boolean().default(true),
      dmOnSanction: z.boolean().default(true),
      /** Escalade automatique selon le nombre de warns actifs */
      warnThresholds: z
        .array(warnThresholdSchema)
        .max(20)
        .default([
          { count: 2, action: "timeout", durationMinutes: 10 },
          { count: 3, action: "timeout", durationMinutes: 60 },
          { count: 4, action: "kick", durationMinutes: null },
          { count: 5, action: "ban", durationMinutes: null },
        ]),
      /** Les warns expirent après N jours (0 = jamais) */
      warnExpiryDays: z.number().int().min(0).max(3650).default(0),
    })
    .prefault({}),

  antiSpam: z
    .object({
      enabled: z.boolean().default(true),
      windowSeconds: z.number().int().min(2).max(120).default(5),
      /** Nombre de messages dans la fenêtre déclenchant un avertissement */
      warnMessages: z.number().int().min(2).max(100).default(5),
      /** Nombre de messages dans la fenêtre déclenchant suppression + timeout */
      timeoutMessages: z.number().int().min(3).max(200).default(10),
      /** Nombre de messages déclenchant un timeout long (spam extrême) */
      severeMessages: z.number().int().min(4).max(400).default(20),
      duplicateCount: z.number().int().min(2).max(50).default(4),
      duplicateWindowSeconds: z.number().int().min(5).max(600).default(30),
      /** Seuil de similarité (0-1) pour considérer deux messages « presque identiques » */
      similarityThreshold: z.number().min(0.5).max(1).default(0.85),
      maxMentionsPerMessage: z.number().int().min(1).max(100).default(6),
      maxMentionsInWindow: z.number().int().min(1).max(200).default(10),
      maxEmojisPerMessage: z.number().int().min(1).max(200).default(20),
      maxRepeatedChars: z.number().int().min(5).max(500).default(25),
      maxLinksInWindow: z.number().int().min(1).max(100).default(6),
      /** Tolérance : nombre d'infractions légères avant sanction */
      tolerance: z.number().int().min(0).max(10).default(1),
      timeoutMinutes: z.number().int().min(1).max(40320).default(10),
      severeTimeoutMinutes: z.number().int().min(1).max(40320).default(60),
      deleteMessages: z.boolean().default(true),
      ignoredChannelIds: snowflakeList,
      ignoredRoleIds: snowflakeList,
    })
    .prefault({}),

  antiRaid: z
    .object({
      enabled: z.boolean().default(true),
      windowSeconds: z.number().int().min(5).max(600).default(10),
      surveillanceJoins: z.number().int().min(2).max(1000).default(5),
      reinforcedJoins: z.number().int().min(3).max(1000).default(15),
      lockdownJoins: z.number().int().min(4).max(2000).default(30),
      /** Un compte plus jeune que ce nombre de jours est considéré « récent » */
      newAccountDays: z.number().int().min(0).max(365).default(7),
      /** Nombre de comptes au nom similaire dans la fenêtre pour signaler une vague */
      similarNameThreshold: z.number().int().min(2).max(100).default(3),
      /** Délai (s) après l'arrivée pendant lequel une activité est jugée « immédiate » */
      immediateActivitySeconds: z.number().int().min(1).max(600).default(15),
    })
    .prefault({}),

  antiNuke: z
    .object({
      enabled: z.boolean().default(true),
      windowSeconds: z.number().int().min(5).max(600).default(10),
      thresholds: z
        .object({
          channelDelete: z.number().int().min(1).max(500).default(4),
          channelCreate: z.number().int().min(1).max(500).default(8),
          roleDelete: z.number().int().min(1).max(500).default(4),
          roleCreate: z.number().int().min(1).max(500).default(8),
          ban: z.number().int().min(1).max(500).default(5),
          kick: z.number().int().min(1).max(500).default(6),
          permissionUpdate: z.number().int().min(1).max(500).default(8),
          webhookCreate: z.number().int().min(1).max(500).default(5),
          guildUpdate: z.number().int().min(1).max(500).default(4),
        })
        .prefault({}),
      /**
       * Réaction automatique :
       *  - alert : alerte uniquement
       *  - strip_roles : retire les rôles dangereux de l'auteur (réversible)
       *  - ban : bannit l'auteur (irréversible, à activer explicitement)
       */
      mitigation: z.enum(["alert", "strip_roles", "ban"]).default("strip_roles"),
      trustedUserIds: snowflakeList,
    })
    .prefault({}),

  antiAlt: z
    .object({
      enabled: z.boolean().default(true),
      mediumThreshold: z.number().int().min(1).max(100).default(40),
      highThreshold: z.number().int().min(1).max(100).default(70),
      /** Risque moyen → rôle non vérifié ; risque élevé → rôle non vérifié + alerte */
      restrictMedium: z.boolean().default(true),
      restrictHigh: z.boolean().default(true),
    })
    .prefault({}),

  antiBot: z
    .object({
      enabled: z.boolean().default(true),
      /** Action sur un bot à permissions dangereuses : alert, strip_roles (retire ses rôles gérables), kick */
      action: z.enum(["alert", "strip_roles", "kick"]).default("alert"),
      maxBotsInWindow: z.number().int().min(1).max(50).default(3),
      windowMinutes: z.number().int().min(1).max(1440).default(10),
      trustedBotIds: snowflakeList,
    })
    .prefault({}),

  antiPhishing: z
    .object({
      enabled: z.boolean().default(true),
      useBuiltinList: z.boolean().default(true),
      /** Heuristiques : faux Nitro, domaines imitant Discord/Steam, etc. */
      heuristics: z.boolean().default(true),
      blockInvites: z.boolean().default(true),
      allowOwnInvites: z.boolean().default(true),
      blockShorteners: z.boolean().default(false),
      shortenerDomains: z
        .array(domain)
        .max(200)
        .default(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly", "rb.gy", "shorturl.at", "ow.ly", "tiny.cc"]),
      action: z.enum(["delete", "delete_warn", "delete_timeout"]).default("delete_timeout"),
      timeoutMinutes: z.number().int().min(1).max(40320).default(60),
      ignoredRoleIds: snowflakeList,
    })
    .prefault({}),

  verification: z
    .object({
      enabled: z.boolean().default(false),
      unverifiedRoleId: optionalSnowflake,
      memberRoleId: optionalSnowflake,
      channelId: optionalSnowflake,
      /** Délai minimum (s) entre l'arrivée et la vérification */
      minDelaySeconds: z.number().int().min(0).max(3600).default(0),
      /** Âge minimum du compte (heures) pour pouvoir se vérifier (0 = aucun) */
      minAccountAgeHours: z.number().int().min(0).max(8760).default(0),
      /** Refuser les vérifications pendant un lockdown */
      blockDuringLockdown: z.boolean().default(true),
      message: z
        .string()
        .max(2000)
        .default("Bienvenue sur le serveur.\nPour accéder aux salons membres, veuillez confirmer votre arrivée."),
      rules: z.string().max(3000).nullable().default(null),
    })
    .prefault({}),

  welcome: z
    .object({
      enabled: z.boolean().default(false),
      channelId: optionalSnowflake,
      message: z
        .string()
        .max(2000)
        .default(
          "👋 Bienvenue {user} !\nTu es le {memberCount}e membre du serveur.\nPense à consulter le règlement et à effectuer la vérification.",
        ),
      useEmbed: z.boolean().default(true),
      embedColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#3B82F6"),
    })
    .prefault({}),

  tickets: z
    .object({
      enabled: z.boolean().default(true),
      categoryChannelId: optionalSnowflake,
      staffRoleIds: snowflakeList,
      maxOpenPerUser: z.number().int().min(1).max(10).default(2),
      transcriptToCreator: z.boolean().default(false),
    })
    .prefault({}),

  lockdown: z
    .object({
      /** Salons rendus invisibles au rôle non vérifié pendant le lockdown */
      sensitiveChannelIds: snowflakeList,
      /** Passe le niveau de vérification Discord au maximum pendant le lockdown */
      raiseVerificationLevel: z.boolean().default(true),
      /** Suspend les invitations du serveur pendant le lockdown */
      pauseInvites: z.boolean().default(true),
      /** Les membres arrivés depuis moins de N minutes reçoivent le rôle non vérifié */
      quarantineRecentMinutes: z.number().int().min(0).max(1440).default(10),
      /** Levée automatique quand le score revient à NORMAL (lockdown automatique uniquement) */
      autoUnlock: z.boolean().default(false),
    })
    .prefault({}),

  riskEngine: z
    .object({
      points: z
        .object({
          fastJoin: z.number().min(0).max(100).default(1),
          newAccount: z.number().min(0).max(100).default(3),
          joinWave: z.number().min(0).max(100).default(5),
          spam: z.number().min(0).max(100).default(5),
          phishing: z.number().min(0).max(100).default(4),
          nuke: z.number().min(0).max(100).default(10),
          suspiciousBot: z.number().min(0).max(100).default(8),
          highRiskAccount: z.number().min(0).max(100).default(4),
        })
        .prefault({}),
      thresholds: z
        .object({
          surveillance: z.number().min(1).max(10000).default(11),
          reinforced: z.number().min(2).max(10000).default(26),
          lockdown: z.number().min(3).max(10000).default(51),
        })
        .prefault({}),
      /** Points retirés par minute lorsque la situation se calme */
      decayPerMinute: z.number().min(0).max(1000).default(3),
      /** Déclencher automatiquement le lockdown au niveau LOCKDOWN */
      autoLockdown: z.boolean().default(true),
    })
    .prefault({}),
});

export type GuildConfig = z.infer<typeof guildConfigSchema>;

/** Validation croisée des seuils (cohérence entre niveaux). */
export const validatedGuildConfigSchema = guildConfigSchema.superRefine((cfg, ctx) => {
  const t = cfg.riskEngine.thresholds;
  if (!(t.surveillance < t.reinforced && t.reinforced < t.lockdown)) {
    ctx.addIssue({ code: "custom", path: ["riskEngine", "thresholds"], message: "Les seuils doivent être croissants (surveillance < renforcé < lockdown)" });
  }
  const r = cfg.antiRaid;
  if (!(r.surveillanceJoins < r.reinforcedJoins && r.reinforcedJoins < r.lockdownJoins)) {
    ctx.addIssue({ code: "custom", path: ["antiRaid"], message: "Les seuils d'arrivées doivent être croissants" });
  }
  const s = cfg.antiSpam;
  if (!(s.warnMessages < s.timeoutMessages && s.timeoutMessages < s.severeMessages)) {
    ctx.addIssue({ code: "custom", path: ["antiSpam"], message: "Les seuils de messages doivent être croissants (avertissement < timeout < sévère)" });
  }
  if (cfg.antiAlt.mediumThreshold >= cfg.antiAlt.highThreshold) {
    ctx.addIssue({ code: "custom", path: ["antiAlt"], message: "Le seuil moyen doit être inférieur au seuil élevé" });
  }
  const counts = cfg.moderation.warnThresholds.map((w) => w.count);
  if (new Set(counts).size !== counts.length) {
    ctx.addIssue({ code: "custom", path: ["moderation", "warnThresholds"], message: "Chaque palier de warn doit avoir un nombre unique" });
  }
  for (const [i, w] of cfg.moderation.warnThresholds.entries()) {
    if (w.action === "timeout" && !w.durationMinutes) {
      ctx.addIssue({ code: "custom", path: ["moderation", "warnThresholds", i, "durationMinutes"], message: "Un timeout nécessite une durée" });
    }
  }
});

export function defaultGuildConfig(): GuildConfig {
  return guildConfigSchema.parse({});
}

/**
 * Lit une configuration stockée. Les champs absents reçoivent leurs valeurs par défaut,
 * les champs invalides (ex. schéma plus ancien) sont remplacés par les valeurs par défaut de leur section.
 */
export function parseStoredConfig(raw: unknown): GuildConfig {
  const strict = validatedGuildConfigSchema.safeParse(raw ?? {});
  if (strict.success) return strict.data;
  const defaults = defaultGuildConfig();
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(defaults) as (keyof GuildConfig)[]) {
    const section = guildConfigSchema.shape[key].safeParse(source[key]);
    out[key] = section.success ? section.data : defaults[key];
  }
  const merged = validatedGuildConfigSchema.safeParse(out);
  return merged.success ? merged.data : defaults;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Fusion profonde : les tableaux sont remplacés, pas concaténés. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/** Applique un patch partiel puis valide la configuration complète. */
export function applyConfigPatch(current: GuildConfig, patch: unknown) {
  return validatedGuildConfigSchema.safeParse(deepMerge(current, patch));
}

// ─── Accès par chemin (utilisé par /config set) ──────────────

export type LeafKind = "boolean" | "number" | "string" | "snowflake" | "snowflakeList" | "enum" | "domainList" | "json";

export interface ConfigLeaf {
  path: string;
  kind: LeafKind;
  options?: readonly string[];
}

function unwrap(schema: z.ZodType): z.ZodType {
  let s: z.ZodType = schema;
  for (let i = 0; i < 10; i++) {
    const def = (s as unknown as { def: { type: string; innerType?: z.ZodType; in?: z.ZodType } }).def;
    if (def.type === "default" || def.type === "prefault" || def.type === "nullable" || def.type === "optional") {
      s = def.innerType!;
    } else if (def.type === "pipe") {
      s = def.in!;
    } else break;
  }
  return s;
}

function leafKind(path: string, schema: z.ZodType): ConfigLeaf {
  const s = unwrap(schema);
  const def = (s as unknown as { def: { type: string; element?: z.ZodType; entries?: Record<string, string> } }).def;
  switch (def.type) {
    case "boolean":
      return { path, kind: "boolean" };
    case "number":
      return { path, kind: "number" };
    case "enum":
      return { path, kind: "enum", options: Object.values(def.entries ?? {}) };
    case "string":
      return { path, kind: /Id$/.test(path) ? "snowflake" : "string" };
    case "array": {
      if (/Ids$/.test(path)) return { path, kind: "snowflakeList" };
      if (/Domains$/.test(path)) return { path, kind: "domainList" };
      return { path, kind: "json" };
    }
    default:
      return { path, kind: "json" };
  }
}

export function listConfigLeaves(): ConfigLeaf[] {
  const leaves: ConfigLeaf[] = [];
  const walk = (schema: z.ZodType, prefix: string) => {
    const s = unwrap(schema);
    const def = (s as unknown as { def: { type: string; shape?: Record<string, z.ZodType> } }).def;
    if (def.type === "object" && def.shape) {
      for (const [k, child] of Object.entries(def.shape)) walk(child, prefix ? `${prefix}.${k}` : k);
    } else {
      leaves.push(leafKind(prefix, schema));
    }
  };
  walk(guildConfigSchema, "");
  return leaves;
}

export function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (isPlainObject(acc) ? acc[key] : undefined), obj);
}

export function buildPatch(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".");
  const root: Record<string, unknown> = {};
  let cursor = root;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cursor[k] = value;
    else {
      cursor[k] = {};
      cursor = cursor[k] as Record<string, unknown>;
    }
  });
  return root;
}

const MENTION_ID = /^(?:<[#@]&?!?)?(\d{17,20})>?$/;

/** Convertit une saisie texte (Discord) vers le type attendu par la clé de configuration. */
export function coerceConfigValue(leaf: ConfigLeaf, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const input = raw.trim();
  const isNull = ["null", "none", "aucun", "-", ""].includes(input.toLowerCase());
  switch (leaf.kind) {
    case "boolean": {
      if (["true", "on", "oui", "1", "yes"].includes(input.toLowerCase())) return { ok: true, value: true };
      if (["false", "off", "non", "0", "no"].includes(input.toLowerCase())) return { ok: true, value: false };
      return { ok: false, error: "Valeur attendue : true/false (oui/non)" };
    }
    case "number": {
      const n = Number(input.replace(",", "."));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "Nombre attendu" };
    }
    case "enum":
      return leaf.options?.includes(input) ? { ok: true, value: input } : { ok: false, error: `Valeurs possibles : ${leaf.options?.join(", ")}` };
    case "snowflake": {
      if (isNull) return { ok: true, value: null };
      const m = MENTION_ID.exec(input);
      return m ? { ok: true, value: m[1] } : { ok: false, error: "Mention ou ID Discord attendu (ou « none »)" };
    }
    case "snowflakeList": {
      if (isNull) return { ok: true, value: [] };
      const ids: string[] = [];
      for (const part of input.split(/[\s,]+/).filter(Boolean)) {
        const m = MENTION_ID.exec(part);
        if (!m) return { ok: false, error: `Élément invalide : ${part}` };
        ids.push(m[1]!);
      }
      return { ok: true, value: [...new Set(ids)] };
    }
    case "domainList":
      return { ok: true, value: isNull ? [] : input.split(/[\s,]+/).filter(Boolean) };
    case "string":
      return { ok: true, value: isNull && input.toLowerCase() === "null" ? null : input.replace(/\\n/g, "\n") };
    case "json":
      try {
        return { ok: true, value: JSON.parse(input) };
      } catch {
        return { ok: false, error: "JSON invalide" };
      }
  }
}
