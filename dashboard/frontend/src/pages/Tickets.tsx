import { useState } from "react";
import { formatDate, PERMISSION, type ConfigResponse, type GuildSummary, type Paginated } from "../api";
import { useApi } from "../hooks";
import { ConfigForm } from "../components/ConfigForm";
import { Badge, Card, Empty, ErrorBox, Loading, Pagination, UserId } from "../components/ui";

interface Ticket {
  id: number;
  number: number;
  category: string;
  subject: string | null;
  status: string;
  creatorId: string;
  claimedById: string | null;
  handledBy: string[];
  closedById: string | null;
  closeReason: string | null;
  createdAt: string;
  closedAt: string | null;
  _count?: { messages: number };
}

interface TicketDetail extends Ticket {
  messages: Array<{ id: number; authorTag: string; authorId: string; authorBot: boolean; content: string; createdAt: string; attachments: Array<{ name: string; url: string }> | null }>;
}

const CATEGORY: Record<string, string> = { SUPPORT: "🛠️ Support", REPORT: "🚨 Signalement", PARTNERSHIP: "🤝 Partenariat", QUESTION: "💬 Question", PURCHASE: "🛒 Achat", OTHER: "📋 Autre" };
const STATUS: Record<string, { label: string; tone: string }> = {
  OPEN: { label: "Ouvert", tone: "info" },
  CLAIMED: { label: "Pris en charge", tone: "warning" },
  CLOSED: { label: "Fermé", tone: "neutral" },
  DELETED: { label: "Supprimé", tone: "danger" },
};

function TicketView({ guild, id, onBack }: { guild: GuildSummary; id: number; onBack: () => void }) {
  const { data, error, loading } = useApi<{ ticket: TicketDetail }>(`/api/guilds/${guild.id}/tickets/${id}`);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const t = data.ticket;
  return (
    <Card
      title={`Ticket #${t.number} — ${CATEGORY[t.category] ?? t.category}`}
      actions={
        <>
          {(t.status === "CLOSED" || t.status === "DELETED") && (
            <a className="btn btn-ghost" href={`/api/guilds/${guild.id}/tickets/${t.id}/transcript`} target="_blank" rel="noreferrer">
              Transcript HTML
            </a>
          )}
          <button className="btn btn-ghost" onClick={onBack}>
            ← Retour
          </button>
        </>
      }
    >
      <dl className="meta-grid">
        <dt>Statut</dt>
        <dd>
          <Badge tone={STATUS[t.status]?.tone}>{STATUS[t.status]?.label ?? t.status}</Badge>
        </dd>
        <dt>Créateur</dt>
        <dd>
          <UserId id={t.creatorId} />
        </dd>
        <dt>Équipe</dt>
        <dd>{t.handledBy.length ? t.handledBy.map((h) => <UserId key={h} id={h} />) : "—"}</dd>
        <dt>Ouvert le</dt>
        <dd>{formatDate(t.createdAt)}</dd>
        <dt>Fermé le</dt>
        <dd>{formatDate(t.closedAt)}</dd>
        <dt>Raison de fermeture</dt>
        <dd>{t.closeReason ?? "—"}</dd>
      </dl>
      <h3>Messages ({t.messages.length})</h3>
      {t.messages.length === 0 ? (
        <Empty>Les messages sont archivés à la fermeture du ticket.</Empty>
      ) : (
        <div className="transcript">
          {t.messages.map((m) => (
            <div key={m.id} className="transcript-msg">
              <div className="small">
                <strong className={m.authorBot ? "text-info" : ""}>{m.authorTag}</strong> <span className="muted">{formatDate(m.createdAt)}</span>
              </div>
              <div className="pre-wrap">{m.content || <span className="muted">(aucun texte)</span>}</div>
              {m.attachments?.map((a) => (
                <a key={a.url} href={a.url} target="_blank" rel="noreferrer noopener" className="small">
                  📎 {a.name}
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TicketSettings({ guild }: { guild: GuildSummary }) {
  const { data, error, setData } = useApi<ConfigResponse>(`/api/guilds/${guild.id}/config`);
  if (!data) return <ErrorBox error={error} />;
  return (
    <Card title="Réglages des tickets">
      <ConfigForm
        guildId={guild.id}
        section="tickets"
        data={data}
        onSaved={(config) => setData({ ...data, config })}
        fields={[
          { key: "enabled", label: "Activé", type: "toggle" },
          { key: "categoryChannelId", label: "Catégorie des salons de tickets", type: "category" },
          { key: "staffRoleIds", label: "Rôles de l'équipe support", type: "roles" },
          { key: "maxOpenPerUser", label: "Tickets ouverts max par membre", type: "number", min: 1, max: 10 },
          { key: "transcriptToCreator", label: "Envoyer le transcript au créateur", type: "toggle" },
        ]}
      />
    </Card>
  );
}

export function TicketsPage({ guild }: { guild: GuildSummary }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const { data, error, loading } = useApi<Paginated<Ticket>>(`/api/guilds/${guild.id}/tickets?page=${page}${status ? `&status=${status}` : ""}`);

  return (
    <div className="page">
      <header className="page-header">
        <h1>🎫 Tickets</h1>
      </header>
      {selected !== null ? (
        <TicketView guild={guild} id={selected} onBack={() => setSelected(null)} />
      ) : (
        <Card
          title="Tickets"
          actions={
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          }
        >
          <ErrorBox error={error} />
          {loading && !data ? (
            <Loading />
          ) : !data?.items.length ? (
            <Empty>Aucun ticket.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Catégorie</th>
                      <th>Sujet</th>
                      <th>Statut</th>
                      <th>Créateur</th>
                      <th>Ouvert le</th>
                      <th>Messages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((t) => (
                      <tr key={t.id} className="clickable" onClick={() => setSelected(t.id)}>
                        <td>{t.number}</td>
                        <td>{CATEGORY[t.category] ?? t.category}</td>
                        <td>{t.subject ?? <span className="muted">—</span>}</td>
                        <td>
                          <Badge tone={STATUS[t.status]?.tone}>{STATUS[t.status]?.label ?? t.status}</Badge>
                        </td>
                        <td>
                          <UserId id={t.creatorId} />
                        </td>
                        <td>{formatDate(t.createdAt)}</td>
                        <td>{t._count?.messages ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />
            </>
          )}
        </Card>
      )}
      {guild.level >= PERMISSION.ADMIN && selected === null && <TicketSettings guild={guild} />}
    </div>
  );
}
