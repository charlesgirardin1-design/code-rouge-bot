import { useState } from "react";
import { api, type ApiError, formatDate, PERMISSION, type ConfigResponse, type GuildSummary, type Paginated, type SecurityEvent } from "../api";
import { useApi } from "../hooks";
import { ConfigForm, type FieldDef } from "../components/ConfigForm";
import { Badge, Card, Empty, ErrorBox, EVENT_LABELS, Loading, Pagination, SEVERITY_TONE, UserId } from "../components/ui";

export const SECURITY_SECTIONS: Array<{ section: string; nested?: string; title: string; fields: FieldDef[] }> = [
  {
    section: "antiRaid",
    title: "Anti-Raid",
    fields: [
      { key: "enabled", label: "Activé", type: "toggle" },
      { key: "windowSeconds", label: "Fenêtre (secondes)", type: "number", min: 5, max: 600 },
      { key: "surveillanceJoins", label: "Arrivées → Surveillance", type: "number", min: 2 },
      { key: "reinforcedJoins", label: "Arrivées → Sécurité renforcée", type: "number", min: 3 },
      { key: "lockdownJoins", label: "Arrivées → Lockdown", type: "number", min: 4 },
      { key: "newAccountDays", label: "Compte « récent » (jours)", type: "number", min: 0, max: 365 },
      { key: "similarNameThreshold", label: "Pseudos similaires pour une vague", type: "number", min: 2 },
      { key: "immediateActivitySeconds", label: "Activité « immédiate » après l'arrivée (s)", type: "number", min: 1 },
    ],
  },
  {
    section: "antiSpam",
    title: "Anti-Spam",
    fields: [
      { key: "enabled", label: "Activé", type: "toggle" },
      { key: "windowSeconds", label: "Fenêtre (secondes)", type: "number", min: 2, max: 120 },
      { key: "warnMessages", label: "Messages → avertissement", type: "number", min: 2 },
      { key: "timeoutMessages", label: "Messages → suppression + timeout", type: "number", min: 3 },
      { key: "severeMessages", label: "Messages → timeout long", type: "number", min: 4 },
      { key: "duplicateCount", label: "Messages identiques tolérés", type: "number", min: 2 },
      { key: "duplicateWindowSeconds", label: "Fenêtre des doublons (s)", type: "number", min: 5 },
      { key: "similarityThreshold", label: "Seuil de similarité (0,5 – 1)", type: "number", min: 0.5, max: 1, step: 0.01 },
      { key: "maxMentionsPerMessage", label: "Mentions max par message", type: "number", min: 1 },
      { key: "maxMentionsInWindow", label: "Mentions max dans la fenêtre", type: "number", min: 1 },
      { key: "maxEmojisPerMessage", label: "Emojis max par message", type: "number", min: 1 },
      { key: "maxRepeatedChars", label: "Caractères répétés max", type: "number", min: 5 },
      { key: "maxLinksInWindow", label: "Liens max dans la fenêtre", type: "number", min: 1 },
      { key: "tolerance", label: "Tolérance (infractions avant timeout)", type: "number", min: 0, max: 10 },
      { key: "timeoutMinutes", label: "Durée du timeout (min)", type: "number", min: 1 },
      { key: "severeTimeoutMinutes", label: "Durée du timeout long (min)", type: "number", min: 1 },
      { key: "deleteMessages", label: "Supprimer les messages de spam", type: "toggle" },
      { key: "ignoredChannelIds", label: "Salons ignorés", type: "channels" },
      { key: "ignoredRoleIds", label: "Rôles ignorés", type: "roles" },
    ],
  },
  {
    section: "antiNuke",
    title: "Anti-Nuke",
    fields: [
      { key: "enabled", label: "Activé", type: "toggle" },
      { key: "windowSeconds", label: "Fenêtre (secondes)", type: "number", min: 5 },
      {
        key: "mitigation",
        label: "Réaction",
        type: "select",
        options: [
          { value: "alert", label: "Alerte uniquement" },
          { value: "strip_roles", label: "Retirer les rôles dangereux (réversible)" },
          { value: "ban", label: "Bannir l'auteur (irréversible)" },
        ],
      },
      { key: "trustedUserIds", label: "Utilisateurs de confiance (IDs)", type: "ids", help: "Ignorés par l'anti-nuke. Réservé au propriétaire." },
    ],
  },
  {
    section: "antiNuke",
    nested: "thresholds",
    title: "Anti-Nuke — seuils par fenêtre",
    fields: [
      { key: "channelDelete", label: "Suppressions de salons", type: "number", min: 1 },
      { key: "channelCreate", label: "Créations de salons", type: "number", min: 1 },
      { key: "roleDelete", label: "Suppressions de rôles", type: "number", min: 1 },
      { key: "roleCreate", label: "Créations de rôles", type: "number", min: 1 },
      { key: "ban", label: "Bannissements", type: "number", min: 1 },
      { key: "kick", label: "Expulsions", type: "number", min: 1 },
      { key: "permissionUpdate", label: "Modifications de permissions", type: "number", min: 1 },
      { key: "webhookCreate", label: "Créations de webhooks", type: "number", min: 1 },
      { key: "guildUpdate", label: "Modifications du serveur", type: "number", min: 1 },
    ],
  },
  {
    section: "antiAlt",
    title: "Anti-Alt",
    fields: [
      { key: "enabled", label: "Activé", type: "toggle" },
      { key: "mediumThreshold", label: "Seuil de risque moyen (0-100)", type: "number", min: 1, max: 100 },
      { key: "highThreshold", label: "Seuil de risque élevé (0-100)", type: "number", min: 1, max: 100 },
      { key: "restrictMedium", label: "Risque moyen → vérification requise", type: "toggle" },
      { key: "restrictHigh", label: "Risque élevé → accès limité + alerte", type: "toggle" },
    ],
  },
  {
    section: "antiBot",
    title: "Anti-Bot",
    fields: [
      { key: "enabled", label: "Activé", type: "toggle" },
      {
        key: "action",
        label: "Bot à permissions dangereuses",
        type: "select",
        options: [
          { value: "alert", label: "Alerte uniquement" },
          { value: "strip_roles", label: "Neutraliser ses permissions" },
          { value: "kick", label: "Expulser le bot" },
        ],
      },
      { key: "maxBotsInWindow", label: "Bots ajoutés max dans la fenêtre", type: "number", min: 1 },
      { key: "windowMinutes", label: "Fenêtre (minutes)", type: "number", min: 1 },
      { key: "trustedBotIds", label: "Bots de confiance (IDs)", type: "ids" },
    ],
  },
  {
    section: "antiPhishing",
    title: "Anti-Phishing",
    fields: [
      { key: "enabled", label: "Activé", type: "toggle" },
      { key: "useBuiltinList", label: "Liste de domaines de phishing intégrée", type: "toggle" },
      { key: "heuristics", label: "Heuristiques (faux Nitro, domaines imitant Discord/Steam)", type: "toggle" },
      { key: "blockInvites", label: "Bloquer les invitations Discord externes", type: "toggle" },
      { key: "allowOwnInvites", label: "Autoriser les invitations du serveur", type: "toggle" },
      { key: "blockShorteners", label: "Bloquer les raccourcisseurs d'URL", type: "toggle" },
      { key: "shortenerDomains", label: "Raccourcisseurs", type: "list" },
      {
        key: "action",
        label: "Action",
        type: "select",
        options: [
          { value: "delete", label: "Supprimer" },
          { value: "delete_warn", label: "Supprimer + avertir" },
          { value: "delete_timeout", label: "Supprimer + timeout" },
        ],
      },
      { key: "timeoutMinutes", label: "Durée du timeout (min)", type: "number", min: 1 },
      { key: "ignoredRoleIds", label: "Rôles ignorés", type: "roles" },
    ],
  },
  {
    section: "riskEngine",
    title: "Moteur de risque",
    fields: [
      { key: "decayPerMinute", label: "Décroissance (points / minute)", type: "number", min: 0, step: 0.5 },
      { key: "autoLockdown", label: "Lockdown automatique au niveau 4", type: "toggle" },
    ],
  },
  {
    section: "riskEngine",
    nested: "thresholds",
    title: "Moteur de risque — seuils des niveaux",
    fields: [
      { key: "surveillance", label: "Niveau 2 — Surveillance à partir de", type: "number", min: 1 },
      { key: "reinforced", label: "Niveau 3 — Sécurité renforcée à partir de", type: "number", min: 2 },
      { key: "lockdown", label: "Niveau 4 — Lockdown à partir de", type: "number", min: 3 },
    ],
  },
  {
    section: "riskEngine",
    nested: "points",
    title: "Moteur de risque — points par événement",
    fields: [
      { key: "fastJoin", label: "Arrivée rapide", type: "number", min: 0, step: 0.5 },
      { key: "newAccount", label: "Compte récent (pendant une vague)", type: "number", min: 0, step: 0.5 },
      { key: "joinWave", label: "Vague d'arrivées", type: "number", min: 0, step: 0.5 },
      { key: "spam", label: "Spam sanctionné", type: "number", min: 0, step: 0.5 },
      { key: "phishing", label: "Phishing", type: "number", min: 0, step: 0.5 },
      { key: "nuke", label: "Comportement administratif suspect", type: "number", min: 0, step: 0.5 },
      { key: "suspiciousBot", label: "Bot suspect", type: "number", min: 0, step: 0.5 },
      { key: "highRiskAccount", label: "Compte à risque élevé", type: "number", min: 0, step: 0.5 },
    ],
  },
  {
    section: "lockdown",
    title: "Lockdown",
    fields: [
      { key: "sensitiveChannelIds", label: "Salons sensibles", type: "channels", help: "Rendus inaccessibles au rôle non vérifié pendant le lockdown." },
      { key: "raiseVerificationLevel", label: "Relever le niveau de vérification Discord", type: "toggle" },
      { key: "pauseInvites", label: "Suspendre les invitations", type: "toggle" },
      { key: "quarantineRecentMinutes", label: "Quarantaine des arrivées des N dernières minutes", type: "number", min: 0 },
      { key: "autoUnlock", label: "Levée automatique (lockdown automatique uniquement)", type: "toggle" },
    ],
  },
];

const EVENT_TYPES = ["", "RAID", "SPAM", "NUKE", "PHISHING", "ALT", "BOT_ADDED", "LOCKDOWN", "UNLOCK", "LEVEL_CHANGE"];

interface ListEntry {
  id: number;
  type: "DOMAIN" | "INVITE";
  value: string;
  reason: string | null;
  addedBy: string;
  createdAt: string;
}

function DomainLists({ guild }: { guild: GuildSummary }) {
  const { data, error, reload } = useApi<{ whitelist: ListEntry[]; blacklist: ListEntry[] }>(`/api/guilds/${guild.id}/lists`);
  const [form, setForm] = useState({ kind: "blacklist", type: "DOMAIN", value: "", reason: "" });
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const canEdit = guild.level >= PERMISSION.ADMIN;

  async function add() {
    setActionError(null);
    try {
      await api.post(`/api/guilds/${guild.id}/lists`, { ...form, reason: form.reason || null });
      setForm({ ...form, value: "", reason: "" });
      reload();
    } catch (e) {
      setActionError(e as ApiError);
    }
  }
  async function remove(kind: string, entry: ListEntry) {
    setActionError(null);
    try {
      await api.del(`/api/guilds/${guild.id}/lists/${kind}/${entry.type}/${encodeURIComponent(entry.value)}`);
      reload();
    } catch (e) {
      setActionError(e as ApiError);
    }
  }

  return (
    <Card title="Listes de domaines et d'invitations">
      <ErrorBox error={error ?? actionError} />
      {canEdit && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, type: e.target.value === "blacklist" ? "DOMAIN" : form.type })}>
            <option value="blacklist">Liste noire</option>
            <option value="whitelist">Liste blanche</option>
          </select>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} disabled={form.kind === "blacklist"}>
            <option value="DOMAIN">Domaine</option>
            <option value="INVITE">Invitation</option>
          </select>
          <input placeholder={form.type === "DOMAIN" ? "exemple.com" : "discord.gg/code"} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />
          <input placeholder="Raison (optionnel)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <button className="btn btn-primary" type="submit">
            Ajouter
          </button>
        </form>
      )}
      <div className="grid-2">
        {(["whitelist", "blacklist"] as const).map((kind) => (
          <div key={kind}>
            <h3>{kind === "whitelist" ? "🟢 Liste blanche" : "🔴 Liste noire"}</h3>
            {!data?.[kind].length ? (
              <Empty>Vide</Empty>
            ) : (
              <ul className="entry-list">
                {data[kind].map((entry) => (
                  <li key={entry.id}>
                    <span>
                      {entry.type === "INVITE" ? "✉️ discord.gg/" : "🌐 "}
                      <code>{entry.value}</code> {entry.reason && <span className="muted small">— {entry.reason}</span>}
                    </span>
                    {canEdit && (
                      <button className="btn btn-ghost small" onClick={() => void remove(kind, entry)}>
                        Retirer
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Events({ guild }: { guild: GuildSummary }) {
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const { data, error, loading } = useApi<Paginated<SecurityEvent>>(`/api/guilds/${guild.id}/security/events?page=${page}${type ? `&type=${type}` : ""}`);
  return (
    <Card
      title="Événements de sécurité"
      actions={
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t ? (EVENT_LABELS[t] ?? t) : "Tous les types"}
            </option>
          ))}
        </select>
      }
    >
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty>Aucun événement.</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Gravité</th>
                  <th>Utilisateur</th>
                  <th>Auteur</th>
                  <th>Action</th>
                  <th>Détails</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.createdAt)}</td>
                    <td>
                      {EVENT_LABELS[e.type] ?? e.type} {e.simulated && <Badge tone="info">simulation</Badge>}
                    </td>
                    <td>
                      <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity}</Badge>
                    </td>
                    <td>
                      <UserId id={e.userId} />
                    </td>
                    <td>
                      <UserId id={e.executorId} />
                    </td>
                    <td>{e.actionTaken ?? "—"}</td>
                    <td>
                      {e.details && (
                        <details>
                          <summary>Voir</summary>
                          <pre>{JSON.stringify(e.details, null, 2)}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

function SecuritySettings({ guild }: { guild: GuildSummary }) {
  const { data, error, loading, setData } = useApi<ConfigResponse>(`/api/guilds/${guild.id}/config`);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  return (
    <>
      {SECURITY_SECTIONS.map((s) => (
        <Card key={`${s.section}.${s.nested ?? ""}`} title={s.title}>
          <ConfigForm guildId={guild.id} section={s.section} nested={s.nested} fields={s.fields} data={data} onSaved={(config) => setData({ ...data, config })} />
        </Card>
      ))}
    </>
  );
}

export function SecurityPage({ guild }: { guild: GuildSummary }) {
  const [tab, setTab] = useState<"events" | "lists" | "settings">("events");
  const isAdmin = guild.level >= PERMISSION.ADMIN;
  return (
    <div className="page">
      <header className="page-header">
        <h1>🟣 Sécurité</h1>
      </header>
      <div className="tabs">
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>
          Événements
        </button>
        <button className={tab === "lists" ? "active" : ""} onClick={() => setTab("lists")}>
          Domaines
        </button>
        {isAdmin && (
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
            Réglages
          </button>
        )}
      </div>
      {tab === "events" && <Events guild={guild} />}
      {tab === "lists" && <DomainLists guild={guild} />}
      {tab === "settings" && isAdmin && <SecuritySettings guild={guild} />}
    </div>
  );
}
