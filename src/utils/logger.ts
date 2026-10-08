import { pino, type Logger } from "pino";
import { sensitiveValues } from "../config/env.js";

const TOKEN_PATTERN = /[MN][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}/g;
const DB_URL_PATTERN = /postgres(?:ql)?:\/\/[^\s"']+/gi;

/** Masque les secrets connus et tout ce qui ressemble à un token Discord ou une URL de base de données. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const secret of sensitiveValues()) {
    out = out.split(secret).join("[REDACTED]");
  }
  return out.replace(TOKEN_PATTERN, "[REDACTED_TOKEN]").replace(DB_URL_PATTERN, "[REDACTED_DB_URL]");
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === "string") return redactSecrets(value);
  if (value instanceof Error) {
    return { name: value.name, message: redactSecrets(value.message), stack: value.stack ? redactSecrets(value.stack) : undefined, ...("code" in value ? { code: (value as { code: unknown }).code } : {}) };
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, depth + 1);
    return out;
  }
  return value;
}

export const logger: Logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  redact: {
    paths: ["token", "*.token", "headers.authorization", "*.headers.authorization", "accessToken", "*.accessToken", "password", "*.password"],
    censor: "[REDACTED]",
  },
  hooks: {
    logMethod(args, method) {
      method.apply(this, args.map((a) => scrub(a)) as Parameters<typeof method>);
    },
  },
  ...(process.env["NODE_ENV"] === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } }
    : {}),
});

export function childLogger(module: string): Logger {
  return logger.child({ module });
}
