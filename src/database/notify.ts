import pg from "pg";
import { z } from "zod";
import { childLogger } from "../utils/logger.js";
import { getPrisma } from "./client.js";

const log = childLogger("pg-notify");
const CHANNEL = "coderouge_events";

/** Événements échangés entre le dashboard et le bot via PostgreSQL LISTEN/NOTIFY. */
export const busEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("config_updated"), guildId: z.string() }),
  z.object({ type: z.literal("lists_updated"), guildId: z.string() }),
  z.object({ type: z.literal("announcement_scheduled"), guildId: z.string(), announcementId: z.number() }),
]);
export type BusEvent = z.infer<typeof busEventSchema>;

export async function publishEvent(event: BusEvent): Promise<void> {
  await getPrisma().$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(event)})`;
}

/** Écoute les événements ; se reconnecte automatiquement en cas de perte de connexion. */
export function subscribeEvents(handler: (event: BusEvent) => void): () => Promise<void> {
  let client: pg.Client | null = null;
  let stopped = false;
  let retryTimer: NodeJS.Timeout | null = null;

  const connect = async () => {
    if (stopped) return;
    client = new pg.Client({ connectionString: process.env["DATABASE_URL"] });
    client.on("notification", (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        const parsed = busEventSchema.safeParse(JSON.parse(msg.payload));
        if (parsed.success) handler(parsed.data);
        else log.warn("Événement ignoré : format invalide");
      } catch (err) {
        log.warn({ err }, "Événement illisible");
      }
    });
    client.on("error", (err) => {
      log.error({ err }, "Connexion LISTEN perdue, reconnexion dans 5s");
      void client?.end().catch(() => undefined);
      client = null;
      retryTimer = setTimeout(() => void connect(), 5000);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      log.info("Écoute des événements du dashboard active");
    } catch (err) {
      log.error({ err }, "Impossible d'écouter les événements, nouvel essai dans 5s");
      client = null;
      retryTimer = setTimeout(() => void connect(), 5000);
    }
  };
  void connect();

  return async () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    await client?.end().catch(() => undefined);
  };
}
