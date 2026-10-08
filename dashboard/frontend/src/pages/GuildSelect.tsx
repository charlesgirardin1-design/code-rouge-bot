import { Link } from "react-router-dom";
import { api, guildIconUrl, type Me } from "../api";
import { Empty } from "../components/ui";

export function GuildSelect({ me }: { me: Me }) {
  return (
    <div className="guild-select">
      <header className="page-header">
        <h1>Bonjour {me.user.username} 👋</h1>
        <button
          className="btn btn-ghost"
          onClick={() =>
            void api
              .post("/auth/logout", {})
              .catch(() => undefined)
              .then(() => (window.location.href = "/"))
          }
        >
          Déconnexion
        </button>
      </header>
      <p className="muted">Choisissez un serveur à administrer.</p>
      {me.guilds.length === 0 ? (
        <Empty>
          Aucun serveur accessible. Le bot doit être présent sur le serveur et vous devez y avoir un rôle d'équipe.
          <br />
          Si vous venez de recevoir un rôle, déconnectez-vous puis reconnectez-vous.
        </Empty>
      ) : (
        <div className="guild-grid">
          {me.guilds.map((g) => {
            const icon = guildIconUrl(g);
            return (
              <Link key={g.id} to={`/g/${g.id}/dashboard`} className="guild-card">
                {icon ? <img src={icon} alt="" /> : <span className="guild-fallback big">{g.name.slice(0, 1)}</span>}
                <strong>{g.name}</strong>
                <span className="muted small">{g.levelName}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
