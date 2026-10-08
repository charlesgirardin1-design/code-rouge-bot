import { AuditLogEvent, type Guild, type GuildAuditLogsEntry } from "discord.js";
import { auditEmbed, type LogCategory } from "../../modules/logs/logService.js";
import { Colors } from "../ui/embeds.js";
import type { BotContext } from "../types.js";

interface Descriptor {
  category: LogCategory;
  title: string;
  color: number;
}

const DESCRIPTORS: Partial<Record<AuditLogEvent, Descriptor>> = {
  [AuditLogEvent.ChannelCreate]: { category: "server", title: "➕ Salon créé", color: Colors.success },
  [AuditLogEvent.ChannelDelete]: { category: "server", title: "➖ Salon supprimé", color: Colors.error },
  [AuditLogEvent.ChannelUpdate]: { category: "server", title: "✏️ Salon modifié", color: Colors.info },
  [AuditLogEvent.ChannelOverwriteCreate]: { category: "server", title: "🔐 Permissions de salon ajoutées", color: Colors.warning },
  [AuditLogEvent.ChannelOverwriteUpdate]: { category: "server", title: "🔐 Permissions de salon modifiées", color: Colors.warning },
  [AuditLogEvent.ChannelOverwriteDelete]: { category: "server", title: "🔐 Permissions de salon retirées", color: Colors.warning },
  [AuditLogEvent.RoleCreate]: { category: "server", title: "➕ Rôle créé", color: Colors.success },
  [AuditLogEvent.RoleDelete]: { category: "server", title: "➖ Rôle supprimé", color: Colors.error },
  [AuditLogEvent.RoleUpdate]: { category: "server", title: "✏️ Rôle modifié", color: Colors.info },
  [AuditLogEvent.GuildUpdate]: { category: "server", title: "⚙️ Serveur modifié", color: Colors.warning },
  [AuditLogEvent.WebhookCreate]: { category: "server", title: "🪝 Webhook créé", color: Colors.warning },
  [AuditLogEvent.MemberRoleUpdate]: { category: "members", title: "🎭 Rôles d'un membre modifiés", color: Colors.info },
  // Sanctions appliquées hors du bot (interface Discord, autre bot)
  [AuditLogEvent.MemberBanAdd]: { category: "moderation", title: "🔨 Bannissement (hors bot)", color: Colors.error },
  [AuditLogEvent.MemberBanRemove]: { category: "moderation", title: "🔓 Débannissement (hors bot)", color: Colors.success },
  [AuditLogEvent.MemberKick]: { category: "moderation", title: "👢 Expulsion (hors bot)", color: Colors.error },
};

function display(value: unknown): string {
  if (value === undefined || value === null) return "∅";
  if (Array.isArray(value)) return value.map((v) => (v && typeof v === "object" && "name" in v ? String((v as { name: unknown }).name) : JSON.stringify(v))).join(", ") || "∅";
  if (typeof value === "object") return JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 150);
  return String(value).slice(0, 150);
}

function targetLabel(entry: GuildAuditLogsEntry): string {
  const t = entry.target as { id?: string; name?: string; tag?: string; username?: string } | null;
  if (!t) return entry.targetId ? `\`${entry.targetId}\`` : "—";
  switch (entry.targetType) {
    case "Channel":
      return `${t.name ? `#${t.name}` : "salon"} (\`${t.id ?? entry.targetId}\`)`;
    case "Role":
      return `@${t.name ?? "rôle"} (\`${t.id ?? entry.targetId}\`)`;
    case "User":
      return `<@${t.id ?? entry.targetId}> (${t.tag ?? t.username ?? "?"} · \`${t.id ?? entry.targetId}\`)`;
    default:
      return `${t.name ?? entry.targetType} (\`${t.id ?? entry.targetId ?? "?"}\`)`;
  }
}

/** Journalise les modifications du serveur à partir du journal d'audit Discord (donne l'auteur exact). */
export async function logAuditEntry(entry: GuildAuditLogsEntry, guild: Guild, ctx: BotContext): Promise<void> {
  const descriptor = DESCRIPTORS[entry.action];
  if (!descriptor) return;
  // Les actions du bot sont déjà journalisées par leurs modules (avec plus de contexte).
  if (entry.executorId === ctx.client.user.id) return;

  const changes = entry.changes
    .filter((c) => c.key !== "id")
    .slice(0, 8)
    .map((c) => {
      if (c.key === "$add") return `➕ ${display(c.new)}`;
      if (c.key === "$remove") return `➖ ${display(c.new)}`;
      return `**${c.key}** : ${display(c.old)} → ${display(c.new)}`;
    });

  await ctx.logs.send(guild, descriptor.category, {
    embeds: [
      auditEmbed({
        action: descriptor.title,
        actor: entry.executorId ? `<@${entry.executorId}> (\`${entry.executorId}\`)` : "Inconnu",
        target: targetLabel(entry),
        reason: entry.reason,
        result: "Succès",
        color: descriptor.color,
        extra: changes.length ? [{ name: "Modifications", value: changes.join("\n").slice(0, 1024) }] : [],
      }),
    ],
  });
}
