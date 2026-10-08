import "dotenv/config";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/, "doit être un ID Discord valide");

const booleanString = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url("DATABASE_URL doit être une URL PostgreSQL"),
});

const botSchema = baseSchema.extend({
  DISCORD_TOKEN: z.string().min(50, "DISCORD_TOKEN manquant ou invalide"),
  CLIENT_ID: snowflake,
  DEV_GUILD_ID: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(snowflake.optional()),
  ENABLE_PRESENCE_INTENT: booleanString,
});

const dashboardSchema = baseSchema.extend({
  DISCORD_TOKEN: z.string().min(50, "DISCORD_TOKEN manquant ou invalide"),
  CLIENT_ID: snowflake,
  CLIENT_SECRET: z.string().min(16, "CLIENT_SECRET manquant"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET doit contenir au moins 32 caractères"),
  DASHBOARD_URL: z.string().url(),
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type BotEnv = z.infer<typeof botSchema>;
export type DashboardEnv = z.infer<typeof dashboardSchema>;

function parse<T extends z.ZodType>(schema: T, scope: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    // On n'affiche jamais les valeurs, seulement les clés en erreur.
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuration ${scope} invalide (.env) :\n${issues}`);
  }
  return result.data;
}

export const loadBotEnv = (): BotEnv => parse(botSchema, "du bot");
export const loadDashboardEnv = (): DashboardEnv => parse(dashboardSchema, "du dashboard");

/** Valeurs à ne jamais faire apparaître dans les logs ou les réponses API. */
export function sensitiveValues(): string[] {
  return ["DISCORD_TOKEN", "DATABASE_URL", "SESSION_SECRET", "CLIENT_SECRET"]
    .map((k) => process.env[k])
    .filter((v): v is string => typeof v === "string" && v.length >= 8);
}
