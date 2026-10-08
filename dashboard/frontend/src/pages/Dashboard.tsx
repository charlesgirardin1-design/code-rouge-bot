import { useEffect } from "react";
import { formatDate, LEVEL_INFO, type GuildSummary, type Overview } from "../api";
import { useApi } from "../hooks";
import { Badge, Card, Empty, ErrorBox, EVENT_LABELS, Loading, SEVERITY_TONE } from "../components/ui";

const MODULE_LABELS: Record<string, string> = {
  antiRaid: "Anti-Raid",
  antiSpam: "Anti-Spam",
  antiNuke: "Anti-Nuke",
  antiPhishing: "Anti-Phishing",
  antiAlt: "Anti-Alt",
  antiBot: "Anti-Bot",
  verification: "Vérification",
  welcome: "Bienvenue",
  tickets: "Tickets",
};

const STAT_LABELS: Array<[string, string]> = [
  ["sanctions", "Sanctions"],
  ["messagesDeleted", "Messages supprimés"],
  ["spamDetected", "Spams détectés"],
  ["raidsDetected", "Raids détectés"],
  ["linksBlocked", "Liens bloqués"],
  ["nukeDetected", "Attaques nuke"],
  ["membersVerified", "Membres vérifiés"],
  ["openTickets", "Tickets ouverts"],
];

export function DashboardPage({ guild }: { guild: GuildSummary }) {
  const { data, error, loading, reload } = useApi<Overview>(`/api/guilds/${guild.id}/overview`);
  useEffect(() => {
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const s = data.security;
  const info = LEVEL_INFO[s.level];
  const pct = Math.min(100, (s.score / Math.max(1, s.thresholds.lockdown)) * 100);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Tableau de bord</h1>
        <button className="btn btn-ghost" onClick={reload}>
          ↻ Actualiser
        </button>
      </header>
      <ErrorBox error={error} />

      <div className="grid-2">
        <Card title="🛡️ SECURITY STATUS">
          <div className={`status-banner tone-${info.tone}`}>
            <span className="status-emoji">{info.emoji}</span>
            <div>
              <strong>{info.label}</strong>
              <div className="muted small">Score de menace : {s.score}</div>
            </div>
          </div>
          <div className="gauge" aria-label={`Score ${s.score}`}>
            <div className={`gauge-fill tone-${info.tone}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="gauge-legend small muted">
            <span>Normal</span>
            <span>Surveillance ≥ {s.thresholds.surveillance}</span>
            <span>Renforcé ≥ {s.thresholds.reinforced}</span>
            <span>Lockdown ≥ {s.thresholds.lockdown}</span>
          </div>
          {s.lockdown && (
            <div className="alert alert-danger">
              🔴 <strong>Lockdown actif</strong> depuis {formatDate(s.lockdown.startedAt)} {s.lockdown.automatic ? "(automatique)" : ""} — {s.lockdown.reason}
              <div className="small">Levée avec la commande /unlock sur Discord.</div>
            </div>
          )}
          <ul className="module-list">
            {Object.entries(s.modules).map(([key, on]) => (
              <li key={key}>
                <span>{MODULE_LABELS[key] ?? key}</span>
                <Badge tone={on ? "success" : "neutral"}>{on ? "ON" : "OFF"}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="📊 Statistiques">
          <div className="stat-grid">
            {STAT_LABELS.map(([key, label]) => (
              <div className="stat" key={key}>
                <span className="stat-value">{data.stats[key] ?? 0}</span>
                <span className="stat-label">{label}</span>
              </div>
            ))}
          </div>
          <h3 className="small muted">Dernières 24 heures</h3>
          <div className="chips">
            {Object.keys(s.last24h).length === 0 && <span className="muted small">Aucun événement de sécurité.</span>}
            {Object.entries(s.last24h).map(([type, count]) => (
              <Badge key={type} tone="security">
                {EVENT_LABELS[type] ?? type} : {count}
              </Badge>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Événements de sécurité récents">
        {data.recentEvents.length === 0 ? (
          <Empty>Aucun événement enregistré.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Gravité</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.recentEvents.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.createdAt)}</td>
                    <td>
                      {EVENT_LABELS[e.type] ?? e.type} {e.simulated && <Badge tone="info">simulation</Badge>}
                    </td>
                    <td>
                      <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity}</Badge>
                    </td>
                    <td>{e.actionTaken ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
