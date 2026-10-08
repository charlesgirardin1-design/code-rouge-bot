import type { GuildConfig } from "../../../config/guildConfig.js";

export interface AltRiskInput {
  accountCreatedAt: number;
  hasAvatar: boolean;
  username: string;
  /** Le serveur est-il en surveillance ou plus au moment de l'arrivée */
  duringRaid: boolean;
  /** Pseudo similaire à d'autres arrivées récentes */
  similarToRecent: boolean;
  /** Activité suspecte juste après l'arrivée (lien / mentions dans les premières secondes) */
  immediateActivity: boolean;
  now: number;
}

export type AltRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface AltRiskResult {
  score: number;
  level: AltRiskLevel;
  reasons: string[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Score de risque d'un compte (0-100). Un compte récent seul n'atteint pas le seuil « élevé » :
 * il faut cumuler plusieurs signaux pour qu'un compte soit restreint.
 */
export function computeAltRisk(input: AltRiskInput, cfg: GuildConfig["antiAlt"]): AltRiskResult {
  const reasons: string[] = [];
  let score = 0;
  const age = input.now - input.accountCreatedAt;

  if (age < HOUR) {
    score += 40;
    reasons.push("compte créé il y a moins d'une heure");
  } else if (age < DAY) {
    score += 30;
    reasons.push("compte créé il y a moins de 24 h");
  } else if (age < 7 * DAY) {
    score += 20;
    reasons.push("compte créé il y a moins de 7 jours");
  } else if (age < 30 * DAY) {
    score += 8;
    reasons.push("compte créé il y a moins de 30 jours");
  }

  if (!input.hasAvatar) {
    score += 10;
    reasons.push("aucun avatar");
  }
  if (/^[a-z]+[._]?[a-z]*\d{4,}$/i.test(input.username)) {
    score += 5;
    reasons.push("pseudo de type généré automatiquement");
  }
  if (input.duringRaid) {
    score += 20;
    reasons.push("arrivé pendant une vague d'arrivées");
  }
  if (input.similarToRecent) {
    score += 15;
    reasons.push("pseudo similaire à d'autres arrivées récentes");
  }
  if (input.immediateActivity) {
    score += 25;
    reasons.push("activité suspecte immédiatement après l'arrivée");
  }

  score = Math.min(100, score);
  const level: AltRiskLevel = score >= cfg.highThreshold ? "HIGH" : score >= cfg.mediumThreshold ? "MEDIUM" : "LOW";
  return { score, level, reasons };
}
