import { useState } from "react";
import { api, type ApiError, type ConfigResponse, type GuildSummary } from "../api";
import { useApi } from "../hooks";
import { ConfigForm } from "../components/ConfigForm";
import { Card, ErrorBox, Loading } from "../components/ui";

function AdvancedJson({ guild, data, onSaved }: { guild: GuildSummary; data: ConfigResponse; onSaved: (c: ConfigResponse["config"]) => void }) {
  const [text, setText] = useState(JSON.stringify(data.config, null, 2));
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [saved, setSaved] = useState(false);
  async function save() {
    setError(null);
    setSaved(false);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError(new Error("JSON invalide"));
      return;
    }
    try {
      const res = await api.put<{ config: ConfigResponse["config"] }>(`/api/guilds/${guild.id}/config`, parsed);
      onSaved(res.config);
      setText(JSON.stringify(res.config, null, 2));
      setSaved(true);
    } catch (e) {
      setError(e as ApiError);
    }
  }
  return (
    <Card title="Configuration avancée (JSON)">
      <p className="muted small">Toute la configuration est validée par le serveur avant enregistrement. Les valeurs invalides sont refusées.</p>
      <textarea className="code" rows={20} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <ErrorBox error={error} />
      <div className="form-actions">
        {saved && <span className="text-success">🟢 Enregistré</span>}
        <button className="btn btn-ghost" onClick={() => setText(JSON.stringify(data.config, null, 2))}>
          Réinitialiser
        </button>
        <button className="btn btn-primary" onClick={() => void save()}>
          Enregistrer le JSON
        </button>
      </div>
    </Card>
  );
}

export function SettingsPage({ guild }: { guild: GuildSummary }) {
  const { data, error, loading, setData } = useApi<ConfigResponse>(`/api/guilds/${guild.id}/config`);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const onSaved = (config: ConfigResponse["config"]) => setData({ ...data, config });
  return (
    <div className="page">
      <header className="page-header">
        <h1>⚙️ Paramètres</h1>
      </header>
      <Card title="Permissions du bot">
        <p className="muted small">
          Propriétaire du serveur → OWNER · « Administrateur »/« Gérer le serveur » ou rôle admin → ADMIN · permissions de modération ou rôle modérateur → MODERATOR · rôle support → SUPPORT.
        </p>
        <ConfigForm
          guildId={guild.id}
          section="permissions"
          data={data}
          onSaved={onSaved}
          fields={[
            { key: "adminRoleIds", label: "Rôles administrateurs", type: "roles" },
            { key: "moderatorRoleIds", label: "Rôles modérateurs", type: "roles" },
            { key: "supportRoleIds", label: "Rôles support", type: "roles" },
          ]}
        />
      </Card>
      <Card title="✅ Vérification">
        <ConfigForm
          guildId={guild.id}
          section="verification"
          data={data}
          onSaved={onSaved}
          fields={[
            { key: "enabled", label: "Activée", type: "toggle" },
            { key: "unverifiedRoleId", label: "Rôle non vérifié", type: "role" },
            { key: "memberRoleId", label: "Rôle membre", type: "role" },
            { key: "channelId", label: "Salon de vérification", type: "channel" },
            { key: "minDelaySeconds", label: "Délai minimum après l'arrivée (s)", type: "number", min: 0 },
            { key: "minAccountAgeHours", label: "Âge minimum du compte (heures)", type: "number", min: 0 },
            { key: "blockDuringLockdown", label: "Suspendre la vérification pendant un lockdown", type: "toggle" },
            { key: "message", label: "Message", type: "textarea" },
            { key: "rules", label: "Règlement (optionnel)", type: "textarea" },
          ]}
        />
        <p className="muted small">Publiez ensuite le bouton avec la commande /verify setup sur Discord.</p>
      </Card>
      <Card title="👋 Bienvenue">
        <ConfigForm
          guildId={guild.id}
          section="welcome"
          data={data}
          onSaved={onSaved}
          fields={[
            { key: "enabled", label: "Activé", type: "toggle" },
            { key: "channelId", label: "Salon", type: "channel" },
            { key: "message", label: "Message", type: "textarea", help: "Variables : {user} {username} {server} {memberCount}" },
            { key: "useEmbed", label: "Utiliser un embed", type: "toggle" },
            { key: "embedColor", label: "Couleur de l'embed", type: "color" },
          ]}
        />
      </Card>
      <AdvancedJson key={JSON.stringify(data.config)} guild={guild} data={data} onSaved={onSaved} />
    </div>
  );
}
