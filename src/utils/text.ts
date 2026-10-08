/** Normalise un message pour la comparaison anti-spam (casse, accents, espaces, ponctuation). */
export function normalizeContent(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/<a?:\w+:\d+>/g, ":e:")
    .replace(/[^\p{L}\p{N}:/.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    map.set(bg, (map.get(bg) ?? 0) + 1);
  }
  return map;
}

/** Coefficient de Dice sur bigrammes : 1 = identique, 0 = rien en commun. O(n). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [bg, count] of A) inter += Math.min(count, B.get(bg) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

const UNICODE_EMOJI = /\p{Extended_Pictographic}/gu;
const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;

export function countEmojis(text: string): number {
  return (text.match(UNICODE_EMOJI)?.length ?? 0) + (text.match(CUSTOM_EMOJI)?.length ?? 0);
}

/** Longueur de la plus longue suite d'un même caractère (hors espaces). */
export function longestCharRun(text: string): number {
  let best = 0;
  let run = 0;
  let prev = "";
  for (const ch of text) {
    if (ch === prev && ch !== " ") run++;
    else run = 1;
    prev = ch;
    if (run > best) best = run;
  }
  return best;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Remplace les variables {user}, {username}, {server}, {memberCount}. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (full, key: string) => (key in vars ? String(vars[key]) : full));
}

/** Squelette d'un pseudo pour détecter des comptes similaires (« raider123 » ≈ « raider456 »). */
export function nameSkeleton(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\d_.\-\s]+$/g, "")
    .replace(/[0o]/g, "o")
    .replace(/[1il|]/g, "i")
    .replace(/[^a-z]/g, "");
}
