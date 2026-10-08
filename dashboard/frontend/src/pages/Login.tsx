export function LoginPage() {
  const error = new URLSearchParams(window.location.search).get("error");
  return (
    <div className="login">
      <div className="login-card">
        <h1>🛡️ Code Rouge</h1>
        <p className="muted">Dashboard de modération et de sécurité.</p>
        {error && <div className="alert alert-danger">🔴 La connexion a échoué ou a été refusée. Réessayez.</div>}
        <a className="btn btn-discord" href="/auth/login">
          Se connecter avec Discord
        </a>
        <p className="muted small">Seuls les serveurs où vous disposez d'un rôle d'équipe (support, modération, administration) sont accessibles.</p>
      </div>
    </div>
  );
}
