import type { GuildConfig } from "../../../config/guildConfig.js";
import { countEmojis, longestCharRun, normalizeContent, similarity } from "../../../utils/text.js";
import { ExpiringMap, pruneOlderThan } from "../../../utils/timeWindow.js";

export interface SpamMessageInput {
  guildId: string;
  userId: string;
  channelId: string;
  messageId: string;
  content: string;
  /** Mentions d'utilisateurs + rôles (+ @everyone/@here) */
  mentionCount: number;
  linkCount: number;
  timestamp: number;
}

export type SpamViolation =
  | "MESSAGE_RATE"
  | "DUPLICATE"
  | "NEAR_DUPLICATE"
  | "MASS_MENTION"
  | "MENTION_RATE"
  | "EMOJI_FLOOD"
  | "REPEATED_CHARS"
  | "LINK_RATE";

export const VIOLATION_LABELS: Record<SpamViolation, string> = {
  MESSAGE_RATE: "Messages trop rapides (flood)",
  DUPLICATE: "Messages identiques répétés",
  NEAR_DUPLICATE: "Messages presque identiques répétés",
  MASS_MENTION: "Mentions excessives dans un message",
  MENTION_RATE: "Trop de mentions en peu de temps",
  EMOJI_FLOOD: "Emojis excessifs",
  REPEATED_CHARS: "Caractères répétés",
  LINK_RATE: "Liens répétés",
};

export type SpamAction = "none" | "warn" | "timeout" | "severe_timeout";

export interface MessageRef {
  channelId: string;
  messageId: string;
}

export interface SpamVerdict {
  action: SpamAction;
  violations: SpamViolation[];
  /** Messages à supprimer (le message courant et/ou le flood récent) */
  toDelete: MessageRef[];
  /** Faut-il publier un avertissement visible (anti-flood des avertissements) */
  notify: boolean;
  timeoutMinutes: number;
}

interface TrackedMessage extends MessageRef {
  ts: number;
  norm: string;
}

interface UserSpamState {
  messages: TrackedMessage[];
  mentions: { ts: number; count: number }[];
  links: { ts: number }[];
  offenses: { ts: number }[];
  lastNotifyAt: number;
  /** Dernière sanction (timeout) appliquée : évite les doubles sanctions, sert à l'escalade */
  lastSanction: { ts: number; action: SpamAction } | null;
}

const OFFENSE_MEMORY_MS = 10 * 60_000;
const NOTIFY_COOLDOWN_MS = 10_000;

/**
 * Moteur anti-spam à fenêtres glissantes, entièrement en mémoire.
 * Un message isolé et normal ne déclenche jamais de sanction : seules les infractions
 * répétées (au-delà de la tolérance) ou un flood avéré mènent à un timeout.
 */
export class AntiSpamEngine {
  private readonly states = new ExpiringMap<string, UserSpamState>(OFFENSE_MEMORY_MS);

  evaluate(msg: SpamMessageInput, cfg: GuildConfig["antiSpam"]): SpamVerdict {
    const now = msg.timestamp;
    const key = `${msg.guildId}:${msg.userId}`;
    const state = this.states.getOrCreate(key, () => ({ messages: [], mentions: [], links: [], offenses: [], lastNotifyAt: 0, lastSanction: null }), now);

    const windowMs = cfg.windowSeconds * 1000;
    const keepMs = Math.max(windowMs, cfg.duplicateWindowSeconds * 1000);
    const norm = normalizeContent(msg.content);

    pruneOlderThan(state.messages, keepMs, now);
    pruneOlderThan(state.mentions, windowMs, now);
    pruneOlderThan(state.links, windowMs, now);
    pruneOlderThan(state.offenses, OFFENSE_MEMORY_MS, now);

    const previous = [...state.messages];
    const current: TrackedMessage = { ts: now, channelId: msg.channelId, messageId: msg.messageId, norm };
    state.messages.push(current);
    if (msg.mentionCount > 0) state.mentions.push({ ts: now, count: msg.mentionCount });
    for (let i = 0; i < msg.linkCount; i++) state.links.push({ ts: now });

    const violations: SpamViolation[] = [];
    let severity = "none" as SpamAction;
    let deleteCurrent = false;
    let deleteRecent = false;
    const bump = (a: SpamAction) => {
      const order: SpamAction[] = ["none", "warn", "timeout", "severe_timeout"];
      if (order.indexOf(a) > order.indexOf(severity)) severity = a;
    };

    // 1. Débit de messages (fenêtre glissante)
    const rate = state.messages.filter((m) => now - m.ts <= windowMs).length;
    if (rate >= cfg.severeMessages) {
      violations.push("MESSAGE_RATE");
      bump("severe_timeout");
      deleteRecent = true;
    } else if (rate >= cfg.timeoutMessages) {
      violations.push("MESSAGE_RATE");
      bump("timeout");
      deleteRecent = true;
    } else if (rate >= cfg.warnMessages) {
      violations.push("MESSAGE_RATE");
      bump("warn");
    }

    // 2. Messages identiques / presque identiques
    if (norm.length > 0) {
      const dupWindow = cfg.duplicateWindowSeconds * 1000;
      let identical = 1;
      let similar = 1;
      for (const m of previous) {
        if (now - m.ts > dupWindow) continue;
        if (m.norm === norm) identical++;
        else if (norm.length >= 8 && similarity(m.norm, norm) >= cfg.similarityThreshold) similar++;
      }
      if (identical >= cfg.duplicateCount) {
        violations.push("DUPLICATE");
        deleteCurrent = true;
        bump(identical >= cfg.duplicateCount * 2 ? "timeout" : "warn");
      } else if (identical + similar - 1 >= cfg.duplicateCount) {
        violations.push("NEAR_DUPLICATE");
        deleteCurrent = true;
        bump(identical + similar - 1 >= cfg.duplicateCount * 2 ? "timeout" : "warn");
      }
    }

    // 3. Mentions
    if (msg.mentionCount > cfg.maxMentionsPerMessage) {
      violations.push("MASS_MENTION");
      deleteCurrent = true;
      bump(msg.mentionCount >= cfg.maxMentionsPerMessage * 2 ? "timeout" : "warn");
    }
    const mentionsInWindow = state.mentions.reduce((sum, m) => sum + m.count, 0);
    if (mentionsInWindow > cfg.maxMentionsInWindow && !violations.includes("MASS_MENTION")) {
      violations.push("MENTION_RATE");
      deleteCurrent = true;
      bump("timeout");
    }

    // 4. Contenu : emojis, caractères répétés
    if (countEmojis(msg.content) > cfg.maxEmojisPerMessage) {
      violations.push("EMOJI_FLOOD");
      deleteCurrent = true;
      bump("warn");
    }
    if (longestCharRun(msg.content) > cfg.maxRepeatedChars) {
      violations.push("REPEATED_CHARS");
      deleteCurrent = true;
      bump("warn");
    }

    // 5. Liens répétés
    if (state.links.length > cfg.maxLinksInWindow) {
      violations.push("LINK_RATE");
      deleteCurrent = true;
      bump("warn");
    }

    if (severity === "none") {
      return { action: "none", violations, toDelete: [], notify: false, timeoutMinutes: 0 };
    }

    // Tolérance : les infractions légères n'aboutissent à un timeout qu'après dépassement.
    // Une même rafale (fenêtre en cours) ne compte que pour une infraction.
    if (severity === "warn") {
      const last = state.offenses.at(-1);
      if (!last || now - last.ts > windowMs) {
        state.offenses.push({ ts: now });
        if (state.offenses.length > cfg.tolerance) severity = "timeout";
      }
    }

    const sanctionRank = (a: SpamAction) => (a === "severe_timeout" ? 2 : a === "timeout" ? 1 : 0);
    const recent = state.lastSanction && now - state.lastSanction.ts <= windowMs ? state.lastSanction : null;
    // Récidive : un nouveau timeout peu après un précédent devient un timeout long.
    if (severity === "timeout" && state.lastSanction && !recent) severity = "severe_timeout";

    const toDelete: MessageRef[] = [];
    if (cfg.deleteMessages) {
      if (deleteRecent || sanctionRank(severity) > 0) {
        for (const m of state.messages.filter((x) => now - x.ts <= windowMs)) toDelete.push({ channelId: m.channelId, messageId: m.messageId });
      } else if (deleteCurrent) {
        toDelete.push({ channelId: msg.channelId, messageId: msg.messageId });
      }
    }

    // Sanction déjà appliquée pour cette rafale : on nettoie seulement le message (pas de double sanction).
    if (sanctionRank(severity) > 0 && recent && sanctionRank(severity) <= sanctionRank(recent.action)) {
      return { action: "none", violations, toDelete: cfg.deleteMessages ? [{ channelId: msg.channelId, messageId: msg.messageId }] : [], notify: false, timeoutMinutes: 0 };
    }

    let notify: boolean;
    if (severity === "warn") {
      notify = now - state.lastNotifyAt > NOTIFY_COOLDOWN_MS;
      if (notify) state.lastNotifyAt = now;
    } else {
      notify = true;
      state.lastSanction = { ts: now, action: severity };
    }

    return {
      action: severity,
      violations,
      toDelete,
      notify,
      timeoutMinutes: severity === "severe_timeout" ? cfg.severeTimeoutMinutes : severity === "timeout" ? cfg.timeoutMinutes : 0,
    };
  }

  reset(guildId: string, userId: string): void {
    this.states.delete(`${guildId}:${userId}`);
  }

  sweep(now = Date.now()): number {
    return this.states.sweep(now);
  }

  get trackedUsers(): number {
    return this.states.size;
  }
}
