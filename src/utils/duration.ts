const UNITS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  j: 86_400_000,
  d: 86_400_000,
  w: 604_800_000,
  sem: 604_800_000,
};

/** Parse « 10m », « 1h30m », « 2j », « 1w » → millisecondes. Retourne null si invalide. */
export function parseDuration(input: string): number | null {
  const cleaned = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!cleaned) return null;
  const re = /(\d+)(sem|sec|min|s|m|h|j|d|w)/g;
  let total = 0;
  let consumed = 0;
  for (const match of cleaned.matchAll(re)) {
    total += Number(match[1]) * UNITS[match[2]!]!;
    consumed += match[0].length;
  }
  if (consumed !== cleaned.length || total <= 0) return null;
  return total;
}

export const MAX_TIMEOUT_MS = 28 * 86_400_000;

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const parts: string[] = [];
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (d) parts.push(`${d}j`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}min`);
  if (s && !d) parts.push(`${s}s`);
  return parts.join(" ") || "0s";
}

/**
 * Parse une date de programmation : « 2026-10-09 18:30 », « 09/10/2026 18:30 » ou relative « dans 2h » / « 2h ».
 * Les dates absolues sont interprétées dans le fuseau donné (Europe/Paris par défaut).
 */
export function parseScheduleDate(input: string, now = new Date(), timeZone = "Europe/Paris"): Date | null {
  const raw = input.trim().toLowerCase().replace(/^dans\s+/, "").replace(/^in\s+/, "");
  const rel = parseDuration(raw);
  if (rel !== null) return new Date(now.getTime() + rel);

  let y: number, mo: number, d: number, h: number, mi: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2}))?$/.exec(raw);
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})[:h](\d{2}))?$/.exec(raw);
  if (iso) [y, mo, d, h, mi] = [Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4] ?? 0), Number(iso[5] ?? 0)];
  else if (fr) [d, mo, y, h, mi] = [Number(fr[1]), Number(fr[2]), Number(fr[3]), Number(fr[4] ?? 0), Number(fr[5] ?? 0)];
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;

  // Conversion de l'heure locale (timeZone) vers UTC : on calcule le décalage du fuseau à cette date.
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const offset = tzOffsetMs(new Date(asUtc), timeZone);
  const result = new Date(asUtc - offset);
  return Number.isNaN(result.getTime()) ? null : result;
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return local - date.getTime();
}
