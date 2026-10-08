import { useState } from "react";
import { formatDate, type ConfigResponse, type GuildSummary, type Paginated } from "../api";
import { useApi } from "../hooks";
import { ConfigForm } from "../components/ConfigForm";
import { Badge, Card, Empty, ErrorBox, Loading, Pagination, UserId } from "../components/ui";

interface AuditLog {
  id: number;
  actorId: string;
  actorType: string;
  action: string;
  targetId: string | null;
  targetType: string | null;
  reason: string | null;
  success: boolean;
  details: Record<string, unknown> | null;
  createdAt: string;
}

const ACTION_FILTERS = [
  { value: "", label: "Toutes les actions" },
  { value: "moderation", label: "Modération" },
  { value: "config", label: "Configuration" },
  { value: "lockdown", label: "Lockdown" },
  { value: "security", label: "Sécurité" },
  { value: "ticket", label: "Tickets" },
  { value: "announcement", label: "Annonces" },
  { value: "verification", label: "Vérification" },
  { value: "whitelist", label: "Liste blanche" },
  { value: "blacklist", label: "Liste noire" },
];

const ACTOR_LABEL: Record<string, string> = { USER: "Discord", DASHBOARD: "Dashboard", BOT: "Bot", SYSTEM: "Système" };

export function LogsPage({ guild }: { guild: GuildSummary }) {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const logs = useApi<Paginated<AuditLog>>(`/api/guilds/${guild.id}/audit-logs?page=${page}${action ? `&action=${action}` : ""}`);
  const cfg = useApi<ConfigResponse>(`/api/guilds/${guild.id}/config`);

  return (
    <div className="page">
      <header className="page-header">
        <h1>📜 Logs</h1>
      </header>
      <Card title="Salons de logs Discord">
        {cfg.data ? (
          <ConfigForm
            guildId={guild.id}
            section="logs"
            data={cfg.data}
            onSaved={(config) => cfg.setData({ ...cfg.data!, config })}
            fields={[
              { key: "moderationChannelId", label: "Logs de modération", type: "channel" },
              { key: "membersChannelId", label: "Logs des membres", type: "channel" },
              { key: "securityChannelId", label: "Logs de sécurité", type: "channel" },
              { key: "serverChannelId", label: "Logs du serveur", type: "channel" },
              { key: "ticketsChannelId", label: "Logs des tickets (transcripts)", type: "channel" },
              { key: "alertRoleIds", label: "Rôles mentionnés lors des alertes critiques", type: "roles" },
              { key: "dmOwnerOnCritical", label: "Alerter le propriétaire en MP (critique)", type: "toggle" },
            ]}
          />
        ) : (
          <ErrorBox error={cfg.error} />
        )}
      </Card>
      <Card
        title="Journal d'audit (qui, quoi, quand, sur qui, pourquoi, résultat)"
        actions={
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            {ACTION_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        }
      >
        <ErrorBox error={logs.error} />
        {logs.loading && !logs.data ? (
          <Loading />
        ) : !logs.data?.items.length ? (
          <Empty>Aucune entrée.</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Quand</th>
                    <th>Qui</th>
                    <th>Quoi</th>
                    <th>Sur qui</th>
                    <th>Pourquoi</th>
                    <th>Résultat</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.data.items.map((l) => (
                    <tr key={l.id}>
                      <td>{formatDate(l.createdAt)}</td>
                      <td>
                        <UserId id={l.actorId} /> <Badge tone="neutral">{ACTOR_LABEL[l.actorType] ?? l.actorType}</Badge>
                      </td>
                      <td>
                        <code>{l.action}</code>
                        {l.details && (
                          <details>
                            <summary className="small">détails</summary>
                            <pre>{JSON.stringify(l.details, null, 2)}</pre>
                          </details>
                        )}
                      </td>
                      <td>{l.targetId ? <code>{l.targetId}</code> : "—"}</td>
                      <td>{l.reason ?? "—"}</td>
                      <td>{l.success ? <Badge tone="success">Succès</Badge> : <Badge tone="danger">Échec</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={logs.data.page} total={logs.data.total} pageSize={logs.data.pageSize} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
