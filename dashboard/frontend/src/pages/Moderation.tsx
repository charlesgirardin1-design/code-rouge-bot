import { useState } from "react";
import { api, type ApiError, formatDate, PERMISSION, type ConfigResponse, type GuildSummary, type Paginated } from "../api";
import { useApi } from "../hooks";
import { ConfigForm } from "../components/ConfigForm";
import { Badge, Card, Empty, ErrorBox, Loading, Pagination, UserId } from "../components/ui";

interface ModerationAction {
  id: number;
  caseNumber: number;
  type: string;
  targetId: string;
  targetTag: string | null;
  moderatorId: string;
  moderatorTag: string | null;
  reason: string | null;
  durationMs: number | null;
  automatic: boolean;
  success: boolean;
  error: string | null;
  createdAt: string;
}

interface Warning {
  id: number;
  userId: string;
  moderatorId: string;
  reason: string;
  active: boolean;
  createdAt: string;
  user: { username: string };
}

const TYPE_LABELS: Record<string, string> = {
  BAN: "🔨 Ban",
  UNBAN: "🔓 Unban",
  KICK: "👢 Kick",
  TIMEOUT: "⏳ Timeout",
  UNTIMEOUT: "✅ Fin de timeout",
  WARN: "⚠️ Warn",
  CLEAR_WARNINGS: "🧹 Warns supprimés",
  CLEAR_MESSAGES: "🧽 Clear",
  SLOWMODE: "🐢 Slowmode",
};

const durationLabel = (ms: number | null) => {
  if (!ms) return "";
  const m = Math.round(ms / 60_000);
  return m >= 1440 ? `${Math.round(m / 1440)} j` : m >= 60 ? `${Math.round(m / 60)} h` : `${m} min`;
};

function Actions({ guild }: { guild: GuildSummary }) {
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [userId, setUserId] = useState("");
  const query = `page=${page}${type ? `&type=${type}` : ""}${/^\d{17,20}$/.test(userId) ? `&userId=${userId}` : ""}`;
  const { data, error, loading } = useApi<Paginated<ModerationAction>>(`/api/guilds/${guild.id}/moderation?${query}`);
  return (
    <Card
      title="Historique des sanctions"
      actions={
        <>
          <input placeholder="ID utilisateur" value={userId} onChange={(e) => setUserId(e.target.value.trim())} />
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous les types</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </>
      }
    >
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty>Aucune sanction.</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cas</th>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Cible</th>
                  <th>Modérateur</th>
                  <th>Raison</th>
                  <th>Résultat</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td>#{a.caseNumber}</td>
                    <td>{formatDate(a.createdAt)}</td>
                    <td>
                      {TYPE_LABELS[a.type] ?? a.type} {durationLabel(a.durationMs)}
                    </td>
                    <td>
                      {a.targetTag ?? ""} <UserId id={a.targetId} />
                    </td>
                    <td>{a.automatic ? <Badge tone="security">Automatique</Badge> : (a.moderatorTag ?? <UserId id={a.moderatorId} />)}</td>
                    <td>{a.reason ?? <span className="muted">—</span>}</td>
                    <td>{a.success ? <Badge tone="success">Succès</Badge> : <Badge tone="danger">{a.error ?? "Échec"}</Badge>}</td>
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

function Warnings({ guild }: { guild: GuildSummary }) {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<Paginated<Warning>>(`/api/guilds/${guild.id}/warnings?page=${page}&active=true`);
  return (
    <Card title="Avertissements actifs">
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty>Aucun avertissement actif.</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Membre</th>
                  <th>Modérateur</th>
                  <th>Raison</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((w) => (
                  <tr key={w.id}>
                    <td>{w.id}</td>
                    <td>{formatDate(w.createdAt)}</td>
                    <td>
                      {w.user.username} <UserId id={w.userId} />
                    </td>
                    <td>
                      <UserId id={w.moderatorId} />
                    </td>
                    <td>{w.reason}</td>
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

interface Threshold {
  count: number;
  action: "none" | "timeout" | "kick" | "ban";
  durationMinutes: number | null;
}

function WarnThresholds({ guild, data, onSaved }: { guild: GuildSummary; data: ConfigResponse; onSaved: (c: ConfigResponse["config"]) => void }) {
  const initial = (data.config["moderation"]?.["warnThresholds"] as Threshold[]) ?? [];
  const [rows, setRows] = useState<Threshold[]>(initial);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const update = (i: number, patch: Partial<Threshold>) => {
    setSaved(false);
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  };
  async function save() {
    setError(null);
    try {
      const res = await api.put<{ config: ConfigResponse["config"] }>(`/api/guilds/${guild.id}/config`, { moderation: { warnThresholds: rows } });
      onSaved(res.config);
      setSaved(true);
    } catch (e) {
      setError(e as ApiError);
    }
  }
  return (
    <Card title="Sanctions automatiques des avertissements">
      <p className="muted small">Au palier atteint, la sanction s'applique automatiquement. Au-delà du dernier palier, le plus élevé s'applique.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre de warns</th>
              <th>Sanction</th>
              <th>Durée (min)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input type="number" min={1} max={50} value={r.count} onChange={(e) => update(i, { count: Number(e.target.value) })} />
                </td>
                <td>
                  <select value={r.action} onChange={(e) => update(i, { action: e.target.value as Threshold["action"], durationMinutes: e.target.value === "timeout" ? (r.durationMinutes ?? 10) : null })}>
                    <option value="none">Aucune</option>
                    <option value="timeout">Timeout</option>
                    <option value="kick">Kick</option>
                    <option value="ban">Ban</option>
                  </select>
                </td>
                <td>
                  {r.action === "timeout" ? (
                    <input type="number" min={1} max={40320} value={r.durationMinutes ?? 10} onChange={(e) => update(i, { durationMinutes: Number(e.target.value) })} />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <button className="btn btn-ghost small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorBox error={error} />
      <div className="form-actions">
        {saved && <span className="text-success">🟢 Enregistré</span>}
        <button className="btn btn-ghost" onClick={() => setRows([...rows, { count: (rows.at(-1)?.count ?? 0) + 1, action: "timeout", durationMinutes: 10 }])}>
          + Palier
        </button>
        <button className="btn btn-primary" onClick={() => void save()}>
          Enregistrer
        </button>
      </div>
    </Card>
  );
}

function ModerationSettings({ guild }: { guild: GuildSummary }) {
  const { data, error, loading, setData } = useApi<ConfigResponse>(`/api/guilds/${guild.id}/config`);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const onSaved = (config: ConfigResponse["config"]) => setData({ ...data, config });
  return (
    <>
      <Card title="Réglages de modération">
        <ConfigForm
          guildId={guild.id}
          section="moderation"
          data={data}
          onSaved={onSaved}
          fields={[
            { key: "confirmBan", label: "Confirmation avant un ban", type: "toggle" },
            { key: "confirmKick", label: "Confirmation avant un kick", type: "toggle" },
            { key: "dmOnSanction", label: "Prévenir le membre en message privé", type: "toggle" },
            { key: "warnExpiryDays", label: "Expiration des warns (jours, 0 = jamais)", type: "number", min: 0 },
          ]}
        />
      </Card>
      <WarnThresholds guild={guild} data={data} onSaved={onSaved} />
    </>
  );
}

export function ModerationPage({ guild }: { guild: GuildSummary }) {
  const [tab, setTab] = useState<"actions" | "warnings" | "settings">("actions");
  return (
    <div className="page">
      <header className="page-header">
        <h1>🔨 Modération</h1>
      </header>
      <div className="tabs">
        <button className={tab === "actions" ? "active" : ""} onClick={() => setTab("actions")}>
          Sanctions
        </button>
        <button className={tab === "warnings" ? "active" : ""} onClick={() => setTab("warnings")}>
          Avertissements
        </button>
        {guild.level >= PERMISSION.ADMIN && (
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
            Réglages
          </button>
        )}
      </div>
      {tab === "actions" && <Actions guild={guild} />}
      {tab === "warnings" && <Warnings guild={guild} />}
      {tab === "settings" && <ModerationSettings guild={guild} />}
    </div>
  );
}
