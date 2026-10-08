export interface TranscriptMessage {
  authorTag: string;
  authorId: string;
  authorBot: boolean;
  content: string;
  attachments: string[];
  embeds: number;
  createdAt: Date;
}

export interface TranscriptMeta {
  guildName: string;
  ticketNumber: number;
  category: string;
  creatorTag: string;
  creatorId: string;
  claimedBy: string | null;
  closedBy: string;
  closeReason: string;
  openedAt: Date;
  closedAt: Date;
}

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const fmt = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

/** Transcript HTML autonome (aucune ressource externe, contenu échappé). */
export function buildTranscriptHtml(meta: TranscriptMeta, messages: TranscriptMessage[]): string {
  const rows = messages
    .map((m) => {
      const attachments = m.attachments
        .filter((url) => /^https:\/\//.test(url))
        .map((url) => `<div class="att"><a href="${escapeHtml(url)}" rel="noopener noreferrer">📎 ${escapeHtml(url.split("/").pop()?.split("?")[0] ?? "pièce jointe")}</a></div>`)
        .join("");
      const embeds = m.embeds ? `<div class="meta">[${m.embeds} embed(s)]</div>` : "";
      return `<div class="msg"><div class="head"><span class="author${m.authorBot ? " bot" : ""}">${escapeHtml(m.authorTag)}</span><span class="id">${escapeHtml(m.authorId)}</span><span class="date">${fmt(m.createdAt)}</span></div><div class="content">${escapeHtml(m.content).replace(/\n/g, "<br>") || '<span class="meta">(aucun texte)</span>'}</div>${attachments}${embeds}</div>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ticket #${meta.ticketNumber} — ${escapeHtml(meta.guildName)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#1e1f22;color:#dbdee1;margin:0;padding:24px}
header{background:#2b2d31;border-radius:8px;padding:16px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 8px}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{color:#949ba4}
.msg{padding:8px 12px;border-radius:6px}.msg:hover{background:#2b2d31}.head{display:flex;gap:8px;align-items:baseline}
.author{font-weight:600;color:#f2f3f5}.author.bot{color:#5865f2}.id,.date,.meta{color:#949ba4;font-size:12px}
.content{margin-top:2px;white-space:normal;word-wrap:break-word}.att a{color:#00a8fc}
</style></head><body>
<header><h1>Ticket #${meta.ticketNumber} — ${escapeHtml(meta.category)}</h1><dl>
<dt>Serveur</dt><dd>${escapeHtml(meta.guildName)}</dd>
<dt>Créé par</dt><dd>${escapeHtml(meta.creatorTag)} (${escapeHtml(meta.creatorId)})</dd>
<dt>Pris en charge par</dt><dd>${escapeHtml(meta.claimedBy ?? "—")}</dd>
<dt>Fermé par</dt><dd>${escapeHtml(meta.closedBy)}</dd>
<dt>Raison</dt><dd>${escapeHtml(meta.closeReason)}</dd>
<dt>Ouvert le</dt><dd>${fmt(meta.openedAt)}</dd><dt>Fermé le</dt><dd>${fmt(meta.closedAt)}</dd>
<dt>Messages</dt><dd>${messages.length}</dd></dl></header>
<main>${rows}</main></body></html>`;
}
