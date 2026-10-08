import { useState } from "react";
import { api, type ApiError, formatDate, type ConfigResponse, type GuildSummary, type Paginated } from "../api";
import { useApi } from "../hooks";
import { Badge, Card, Empty, ErrorBox, Loading, Pagination } from "../components/ui";

interface Announcement {
  id: number;
  channelId: string;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  error: string | null;
  embed: { title: string | null; description: string };
  createdAt: string;
}

const STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Brouillon", tone: "neutral" },
  SCHEDULED: { label: "Programmée", tone: "info" },
  PUBLISHING: { label: "Publication…", tone: "warning" },
  PUBLISHED: { label: "Publiée", tone: "success" },
  FAILED: { label: "Échec", tone: "danger" },
  CANCELLED: { label: "Annulée", tone: "neutral" },
};

const EMPTY = { channelId: "", title: "", description: "", color: "#3b82f6", imageUrl: "", thumbnailUrl: "", footer: "", author: "", mention: "", buttonLabel: "", buttonUrl: "", scheduledAt: "" };

function Preview({ form, roles }: { form: typeof EMPTY; roles: ConfigResponse["roles"] }) {
  const mention = form.mention === "everyone" || form.mention === "here" ? `@${form.mention}` : form.mention ? `@${roles.find((r) => r.id === form.mention)?.name ?? "rôle"}` : null;
  return (
    <div className="discord-preview">
      {mention && <div className="mention">{mention}</div>}
      <div className="discord-embed" style={{ borderLeftColor: form.color || "#3b82f6" }}>
        <div className="embed-body">
          {form.author && <div className="embed-author">{form.author}</div>}
          {form.title && <div className="embed-title">{form.title}</div>}
          <div className="embed-desc">{form.description || <span className="muted">Description de l'annonce…</span>}</div>
          {form.imageUrl.startsWith("https://") && <img className="embed-image" src={form.imageUrl} alt="" />}
          {form.footer && <div className="embed-footer">{form.footer}</div>}
        </div>
        {form.thumbnailUrl.startsWith("https://") && <img className="embed-thumb" src={form.thumbnailUrl} alt="" />}
      </div>
      {form.buttonLabel && <span className="discord-button">{form.buttonLabel} ↗</span>}
    </div>
  );
}

export function AnnouncementsPage({ guild }: { guild: GuildSummary }) {
  const [page, setPage] = useState(1);
  const list = useApi<Paginated<Announcement>>(`/api/guilds/${guild.id}/announcements?page=${page}`);
  const cfg = useApi<ConfigResponse>(`/api/guilds/${guild.id}/config`);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setError(null);
    setDone(null);
    setSending(true);
    const orNull = (v: string) => (v.trim() ? v.trim() : null);
    try {
      await api.post(`/api/guilds/${guild.id}/announcements`, {
        announcement: {
          channelId: form.channelId,
          title: orNull(form.title),
          description: form.description,
          color: form.color,
          imageUrl: orNull(form.imageUrl),
          thumbnailUrl: orNull(form.thumbnailUrl),
          footer: orNull(form.footer),
          author: orNull(form.author),
          mention: orNull(form.mention),
          buttonLabel: orNull(form.buttonLabel),
          buttonUrl: orNull(form.buttonUrl),
        },
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      });
      setDone(form.scheduledAt ? "Annonce programmée." : "Annonce envoyée au bot pour publication immédiate.");
      setForm(EMPTY);
      list.reload();
      setTimeout(list.reload, 4000);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSending(false);
    }
  }

  async function cancel(id: number) {
    try {
      await api.del(`/api/guilds/${guild.id}/announcements/${id}`);
      list.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  const textChannels = cfg.data?.channels.filter((c) => c.type === 0 || c.type === 5) ?? [];
  const channelName = (id: string) => textChannels.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="page">
      <header className="page-header">
        <h1>📢 Annonces</h1>
      </header>
      <div className="grid-2">
        <Card title="Nouvelle annonce">
          <form
            className="config-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="field">
              <label className="field-label">Salon</label>
              <select required value={form.channelId} onChange={(e) => set("channelId", e.target.value)}>
                <option value="">— Choisir —</option>
                {textChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Titre</label>
              <input maxLength={256} value={form.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Description *</label>
              <textarea required rows={6} maxLength={4000} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Couleur</label>
              <input type="color" value={form.color} onChange={(e) => set("color", e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Image (URL https)</label>
              <input type="url" value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Miniature (URL https)</label>
              <input type="url" value={form.thumbnailUrl} onChange={(e) => set("thumbnailUrl", e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Auteur</label>
              <input maxLength={256} value={form.author} onChange={(e) => set("author", e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Pied de page</label>
              <input maxLength={2048} value={form.footer} onChange={(e) => set("footer", e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Mention</label>
              <select value={form.mention} onChange={(e) => set("mention", e.target.value)}>
                <option value="">Aucune</option>
                <option value="everyone">@everyone</option>
                <option value="here">@here</option>
                {cfg.data?.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    @{r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Bouton (texte / URL https)</label>
              <div className="inline-form">
                <input placeholder="Texte" maxLength={80} value={form.buttonLabel} onChange={(e) => set("buttonLabel", e.target.value)} />
                <input placeholder="https://…" type="url" value={form.buttonUrl} onChange={(e) => set("buttonUrl", e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Programmer (optionnel)</label>
              <input type="datetime-local" value={form.scheduledAt} onChange={(e) => set("scheduledAt", e.target.value)} />
            </div>
            <ErrorBox error={error} />
            {done && <div className="alert alert-success">🟢 {done}</div>}
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={sending}>
                {form.scheduledAt ? "⏰ Programmer" : "📢 Publier"}
              </button>
            </div>
          </form>
        </Card>
        <Card title="👁️ Aperçu">
          <Preview form={form} roles={cfg.data?.roles ?? []} />
        </Card>
      </div>
      <Card title="Historique">
        <ErrorBox error={list.error} />
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty>Aucune annonce.</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Titre</th>
                    <th>Salon</th>
                    <th>Statut</th>
                    <th>Programmée</th>
                    <th>Publiée</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((a) => (
                    <tr key={a.id}>
                      <td>{a.id}</td>
                      <td>{a.embed.title ?? a.embed.description.slice(0, 60)}</td>
                      <td>#{channelName(a.channelId)}</td>
                      <td>
                        <Badge tone={STATUS[a.status]?.tone}>{STATUS[a.status]?.label ?? a.status}</Badge>
                        {a.error && <div className="small text-danger">{a.error}</div>}
                      </td>
                      <td>{formatDate(a.scheduledAt)}</td>
                      <td>{formatDate(a.publishedAt)}</td>
                      <td>
                        {(a.status === "SCHEDULED" || a.status === "DRAFT") && (
                          <button className="btn btn-ghost small" onClick={() => void cancel(a.id)}>
                            Annuler
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.page} total={list.data.total} pageSize={list.data.pageSize} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
