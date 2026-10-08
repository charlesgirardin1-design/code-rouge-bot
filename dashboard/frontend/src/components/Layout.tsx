import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { api, guildIconUrl, PERMISSION, type GuildSummary, type Me } from "../api";

const NAV = [
  { to: "dashboard", label: "Tableau de bord", icon: "🛡️", level: PERMISSION.SUPPORT },
  { to: "security", label: "Sécurité", icon: "🟣", level: PERMISSION.MODERATOR },
  { to: "moderation", label: "Modération", icon: "🔨", level: PERMISSION.MODERATOR },
  { to: "logs", label: "Logs", icon: "📜", level: PERMISSION.ADMIN },
  { to: "tickets", label: "Tickets", icon: "🎫", level: PERMISSION.SUPPORT },
  { to: "announcements", label: "Annonces", icon: "📢", level: PERMISSION.ADMIN },
  { to: "settings", label: "Paramètres", icon: "⚙️", level: PERMISSION.ADMIN },
];

export function Layout({ me, guild, children }: { me: Me; guild: GuildSummary; children: ReactNode }) {
  const icon = guildIconUrl(guild);
  async function logout() {
    await api.post("/auth/logout", {}).catch(() => undefined);
    window.location.href = "/";
  }
  return (
    <div className="layout">
      <aside className="sidebar">
        <Link to="/" className="brand">
          🛡️ Code Rouge
        </Link>
        <div className="guild-chip">
          {icon ? <img src={icon} alt="" /> : <span className="guild-fallback">{guild.name.slice(0, 1)}</span>}
          <div>
            <strong>{guild.name}</strong>
            <span className="muted small">{guild.levelName}</span>
          </div>
        </div>
        <nav>
          {NAV.filter((n) => guild.level >= n.level).map((n) => (
            <NavLink key={n.to} to={`/g/${guild.id}/${n.to}`} className={({ isActive }) => (isActive ? "active" : "")}>
              <span aria-hidden>{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="small">{me.user.username}</span>
          <button className="btn btn-ghost small" onClick={() => void logout()}>
            Déconnexion
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
