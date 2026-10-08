import type { ReactNode } from "react";
import type { ApiError } from "../api";

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-header">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Loading() {
  return <div className="muted pad">Chargement…</div>;
}

export function ErrorBox({ error }: { error: ApiError | Error | null }) {
  if (!error) return null;
  const details = "details" in error ? error.details : [];
  return (
    <div className="alert alert-danger" role="alert">
      <strong>🔴 {error.message}</strong>
      {details.length > 0 && (
        <ul>
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <button className="btn btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Précédent
      </button>
      <span className="muted">
        Page {page} / {pages} · {total} élément(s)
      </span>
      <button className="btn btn-ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Suivant →
      </button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted pad center">{children}</div>;
}

export const SEVERITY_TONE: Record<string, string> = { LOW: "neutral", MEDIUM: "warning", HIGH: "orange", CRITICAL: "danger" };

export const EVENT_LABELS: Record<string, string> = {
  RAID: "Raid",
  SPAM: "Spam",
  NUKE: "Anti-nuke",
  PHISHING: "Phishing",
  ALT: "Compte suspect",
  BOT_ADDED: "Bot ajouté",
  LOCKDOWN: "Lockdown",
  UNLOCK: "Fin du lockdown",
  LEVEL_CHANGE: "Niveau de sécurité",
};

export function UserId({ id }: { id: string | null | undefined }) {
  if (!id) return <span className="muted">—</span>;
  return <code title="ID Discord">{id}</code>;
}
