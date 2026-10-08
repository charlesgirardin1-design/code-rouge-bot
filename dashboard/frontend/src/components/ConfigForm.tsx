import { useEffect, useState } from "react";
import { api, ApiError, type ChannelInfo, type ConfigResponse, type RoleInfo } from "../api";
import { ErrorBox } from "./ui";

export type FieldType = "toggle" | "number" | "text" | "textarea" | "channel" | "category" | "channels" | "role" | "roles" | "select" | "color" | "list" | "ids";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
}

interface Props {
  guildId: string;
  section: string;
  fields: FieldDef[];
  data: ConfigResponse;
  onSaved: (config: ConfigResponse["config"]) => void;
  /** Sous-objet de la section (ex. "thresholds") */
  nested?: string;
}

const TEXT_CHANNEL_TYPES = [0, 5];

function ChannelSelect({ value, onChange, channels, category }: { value: string | null; onChange: (v: string | null) => void; channels: ChannelInfo[]; category?: boolean }) {
  const list = channels.filter((c) => (category ? c.type === 4 : TEXT_CHANNEL_TYPES.includes(c.type)));
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— Aucun —</option>
      {list.map((c) => (
        <option key={c.id} value={c.id}>
          {category ? "📁 " : "#"}
          {c.name}
        </option>
      ))}
    </select>
  );
}

function RoleSelect({ value, onChange, roles }: { value: string | null; onChange: (v: string | null) => void; roles: RoleInfo[] }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— Aucun —</option>
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          @{r.name}
        </option>
      ))}
    </select>
  );
}

function MultiSelect({ value, onChange, items }: { value: string[]; onChange: (v: string[]) => void; items: Array<{ id: string; label: string }> }) {
  const [adding, setAdding] = useState("");
  const labelOf = (id: string) => items.find((i) => i.id === id)?.label ?? id;
  return (
    <div className="multi">
      <div className="chips">
        {value.length === 0 && <span className="muted">Aucun</span>}
        {value.map((id) => (
          <span className="chip" key={id}>
            {labelOf(id)}
            <button type="button" aria-label="Retirer" onClick={() => onChange(value.filter((v) => v !== id))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <select
        value={adding}
        onChange={(e) => {
          const id = e.target.value;
          if (id && !value.includes(id)) onChange([...value, id]);
          setAdding("");
        }}
      >
        <option value="">+ Ajouter…</option>
        {items
          .filter((i) => !value.includes(i.id))
          .map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
      </select>
    </div>
  );
}

/** Formulaire générique d'une section de configuration ; la validation fait foi côté serveur. */
export function ConfigForm({ guildId, section, fields, data, onSaved, nested }: Props) {
  const sectionValue = data.config[section] ?? {};
  const source = (nested ? (sectionValue[nested] as Record<string, unknown>) : sectionValue) ?? {};
  const [draft, setDraft] = useState<Record<string, unknown>>(source);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const sourceKey = JSON.stringify(source);
  useEffect(() => setDraft(JSON.parse(sourceKey) as Record<string, unknown>), [sourceKey]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(source);
  const set = (key: string, value: unknown) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const lockedPath = (key: string) => !data.canEditOwnerOnly && data.ownerOnlyPaths.includes(`${section}.${nested ? `${nested}.` : ""}${key}`);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const patch = { [section]: nested ? { [nested]: draft } : draft };
      const res = await api.put<{ config: ConfigResponse["config"] }>(`/api/guilds/${guildId}/config`, patch);
      onSaved(res.config);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "Erreur réseau"));
    } finally {
      setSaving(false);
    }
  }

  const roleItems = data.roles.map((r) => ({ id: r.id, label: `@${r.name}` }));
  const channelItems = data.channels.filter((c) => TEXT_CHANNEL_TYPES.includes(c.type)).map((c) => ({ id: c.id, label: `#${c.name}` }));

  return (
    <form
      className="config-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {fields.map((f) => {
        const value = draft[f.key];
        const locked = lockedPath(f.key);
        let input;
        switch (f.type) {
          case "toggle":
            input = (
              <label className="switch">
                <input type="checkbox" checked={Boolean(value)} disabled={locked} onChange={(e) => set(f.key, e.target.checked)} />
                <span>{value ? "Activé" : "Désactivé"}</span>
              </label>
            );
            break;
          case "number":
            input = <input type="number" value={value as number} min={f.min} max={f.max} step={f.step ?? 1} disabled={locked} onChange={(e) => set(f.key, e.target.value === "" ? 0 : Number(e.target.value))} />;
            break;
          case "text":
            input = <input type="text" value={(value as string | null) ?? ""} disabled={locked} onChange={(e) => set(f.key, e.target.value || null)} />;
            break;
          case "textarea":
            input = <textarea rows={4} value={(value as string | null) ?? ""} disabled={locked} onChange={(e) => set(f.key, e.target.value)} />;
            break;
          case "color":
            input = <input type="color" value={(value as string) ?? "#3b82f6"} disabled={locked} onChange={(e) => set(f.key, e.target.value)} />;
            break;
          case "select":
            input = (
              <select value={value as string} disabled={locked} onChange={(e) => set(f.key, e.target.value)}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
            break;
          case "channel":
          case "category":
            input = <ChannelSelect value={value as string | null} channels={data.channels} category={f.type === "category"} onChange={(v) => set(f.key, v)} />;
            break;
          case "role":
            input = <RoleSelect value={value as string | null} roles={data.roles} onChange={(v) => set(f.key, v)} />;
            break;
          case "roles":
            input = locked ? <span className="muted">Réservé au propriétaire du serveur</span> : <MultiSelect value={(value as string[]) ?? []} items={roleItems} onChange={(v) => set(f.key, v)} />;
            break;
          case "channels":
            input = <MultiSelect value={(value as string[]) ?? []} items={channelItems} onChange={(v) => set(f.key, v)} />;
            break;
          case "list":
          case "ids":
            input = (
              <textarea
                rows={3}
                disabled={locked}
                placeholder={f.type === "ids" ? "Un ID Discord par ligne" : "Une valeur par ligne"}
                value={((value as string[]) ?? []).join("\n")}
                onChange={(e) =>
                  set(
                    f.key,
                    e.target.value
                      .split(/[\n,]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            );
            break;
        }
        return (
          <div className="field" key={f.key}>
            <label>
              <span className="field-label">
                {f.label}
                {locked && <span title="Réservé au propriétaire"> 🔒</span>}
              </span>
              {f.help && <span className="field-help">{f.help}</span>}
            </label>
            <div className="field-input">{input}</div>
          </div>
        );
      })}
      <ErrorBox error={error} />
      <div className="form-actions">
        {saved && !dirty && <span className="text-success">🟢 Enregistré</span>}
        <button type="button" className="btn btn-ghost" disabled={!dirty || saving} onClick={() => setDraft(source)}>
          Annuler
        </button>
        <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

