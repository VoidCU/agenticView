import { useState, type FormEvent } from "react";
import {
  CustomProviderUpsertSchema,
  PROVIDER_KEY_ENV,

  isCustomProvider,
  type CustomProviderInfo,
  type KeyedProvider,
  type Provider,
  type ProviderStatus,
} from "@agenticview/shared";
import { useStore } from "../state/store";
import { LimitChip, SwitchProviderModal } from "./LimitChip";
import { providerLabel } from "./ui";

/** How each built-in provider authenticates, for the provider cards. */
const AUTH_NOTES: Record<string, string> = {
  claude: "Claude Agent SDK with an Anthropic API key. Not the Claude Code login.",
  "claude-session": "Your own Claude Code session: run /agenticview-work in it. Uses that session's plan (Max/Pro); no key.",
  codex: "Codex CLI. Uses the codex login unless a key is set here or CODEX_API_KEY is in the environment.",
  copilot: "GitHub Copilot CLI. Login only: run copilot once and sign in. No API key.",
  antigravity: "Antigravity CLI (agy). Login only: run agy once and sign in. No API key.",
  gemini: "Gemini CLI. Uses its Google login unless a key is set here or GEMINI_API_KEY is in the environment.",
};

function isKeyed(p: string): p is KeyedProvider {
  return p === "claude" || p === "codex" || p === "gemini";
}

/** One provider row in the order list: position, status, limit, failover toggle and move buttons. */
function OrderRow({
  status,
  index,
  count,
  failover,
  onFailover,
  onMove,
}: {
  status: ProviderStatus;
  index: number;
  count: number;
  failover: boolean;
  onFailover: (on: boolean) => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const label = providerLabel(status.provider);
  return (
    <li className="order-row" data-provider={status.provider}>
      <span className="order-pos" aria-hidden="true">{index + 1}</span>
      <span className={`chip-dot order-dot ${status.ok ? "dot-ok" : "dot-off"}`} aria-hidden="true" />
      <span className="order-name">
        {label}
        {isCustomProvider(status.provider) && <span className="provider-more-tag">custom</span>}
        <span className="sr-only">{status.ok ? ", ready" : ", unavailable"}</span>
      </span>
      <span className="order-status">{status.limit?.limited ? <span className="provider-limited">limited</span> : status.ok ? "Ready" : "Unavailable"}</span>
      <label className="order-failover">
        <input type="checkbox" checked={failover} onChange={(e) => onFailover(e.target.checked)} aria-label={`Use ${label} for failover`} />
        <span>Failover</span>
      </label>
      <span className="order-moves">
        <button type="button" className="btn btn-ghost btn-xs" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" className="btn btn-ghost btn-xs" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
          ↓
        </button>
      </span>
    </li>
  );
}

/** Password field for a stored API key: shows whether one is set, never its value. Saves immediately. */
function KeyField({ provider, hasKey }: { provider: KeyedProvider; hasKey: boolean }) {
  const send = useStore((s) => s.send);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const label = providerLabel(provider);
  const save = (key: string | null) => {
    send({ type: "provider.setKey", provider, apiKey: key });
    setValue("");
    setSaved(key ? "Key saved." : "Key cleared.");
  };
  return (
    <div className="key-field">
      <label className="field">
        <span>
          API key <span className={`key-state ${hasKey ? "key-set" : "key-unset"}`}>{hasKey ? "set" : "not set"}</span>
        </span>
        <span className="key-row">
          <input
            type="password"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(null);
            }}
            placeholder={hasKey ? "•••••••• stored" : "not set: login or env is used"}
            autoComplete="off"
            spellCheck={false}
            aria-label={`${label} API key`}
          />
          <button type="button" className="btn btn-ghost btn-sm" disabled={!value.trim()} onClick={() => save(value.trim())}>
            Save key
          </button>
          {hasKey && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => save(null)} aria-label={`Clear ${label} API key`}>
              Clear
            </button>
          )}
        </span>
      </label>
      <p className="hint" role="status">
        {saved ?? `Passed to the ${label} process only, as ${PROVIDER_KEY_ENV[provider]}. An ${PROVIDER_KEY_ENV[provider]} already in the environment wins.`}
      </p>
    </div>
  );
}

interface Draft {
  id: string;
  label: string;
  engine: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  models: string;
  defaultModel: string;
}

const EMPTY_DRAFT: Draft = { id: "", label: "", engine: "openai", baseUrl: "", apiKey: "", models: "", defaultModel: "" };

function draftOf(c: CustomProviderInfo): Draft {
  return {
    id: c.id,
    label: c.label,
    engine: c.engine,
    baseUrl: c.baseUrl,
    apiKey: "",
    models: c.models.map((m) => (m.label ? `${m.id} | ${m.label}` : m.id)).join("\n"),
    defaultModel: c.defaultModel ?? "",
  };
}

/** "id | label" per line -> model list (blank lines dropped, first id wins on duplicates). */
export function parseModelLines(text: string): { id: string; label?: string }[] {
  const out: { id: string; label?: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [rawId, ...rest] = line.split("|");
    const id = (rawId ?? "").trim();
    if (!id || out.some((m) => m.id === id)) continue;
    const label = rest.join("|").trim();
    out.push(label ? { id, label } : { id });
  }
  return out;
}

/** Slug suggestion from a label ("My LLM!" -> "my-llm"). */
export function slugOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

/** Add / edit form for one custom provider. */
function CustomProviderForm({ initial, existingIds, onDone }: { initial?: CustomProviderInfo; existingIds: string[]; onDone: () => void }) {
  const send = useStore((s) => s.send);
  const [d, setD] = useState<Draft>(initial ? draftOf(initial) : EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const models = parseModelLines(d.models);
  const id = editing ? d.id : d.id || slugOf(d.label);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!editing && existingIds.includes(id)) {
      setError(`A custom provider with id "${id}" already exists.`);
      return;
    }
    const payload = {
      id,
      label: d.label.trim(),
      engine: d.engine,
      baseUrl: d.baseUrl.trim(),
      models,
      defaultModel: d.defaultModel.trim() || null,
      // Editing with an empty key field keeps the stored key.
      ...(d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : editing ? {} : { apiKey: null }),
    };
    const parsed = CustomProviderUpsertSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".") || "entry"}: ${i.message}`).join("; "));
      return;
    }
    send({ type: "customProvider.upsert", provider: parsed.data });
    onDone();
  };

  return (
    <form className="custom-form" onSubmit={submit} aria-label={editing ? `Edit ${initial!.label}` : "Add custom provider"}>
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input value={d.label} onChange={(e) => set("label", e.target.value)} placeholder="e.g. Local Ollama" required maxLength={40} />
        </label>
        <label className="field">
          <span>Id</span>
          <input
            value={id}
            onChange={(e) => set("id", e.target.value)}
            disabled={editing}
            placeholder="auto from name"
            pattern="[a-z0-9][a-z0-9\-]{0,31}"
            title="lowercase letters, digits and dashes"
            aria-describedby="custom-id-hint"
          />
        </label>
        <label className="field">
          <span>API type</span>
          <select value={d.engine} onChange={(e) => set("engine", e.target.value as Draft["engine"])}>
            <option value="openai">OpenAI-compatible (Responses API, runs on the Codex CLI)</option>
            <option value="anthropic">Anthropic-compatible (Messages API, runs on the Claude Agent SDK)</option>
          </select>
        </label>
        <label className="field">
          <span>Base URL</span>
          <input
            value={d.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
            placeholder={d.engine === "openai" ? "http://localhost:11434/v1" : "https://api.example.com/anthropic"}
            required
            inputMode="url"
          />
        </label>
        <label className="field field-full">
          <span>API key {editing && <span className={`key-state ${initial!.hasKey ? "key-set" : "key-unset"}`}>{initial!.hasKey ? "set" : "not set"}</span>}</span>
          <input
            type="password"
            value={d.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
            placeholder={editing && initial!.hasKey ? "•••••••• (stored; type to replace)" : d.engine === "openai" ? "optional for local servers" : "required"}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>Models (one per line, optional “id | label”)</span>
          <textarea value={d.models} onChange={(e) => set("models", e.target.value)} rows={3} placeholder={"qwen3-coder\nllama-4 | Llama 4"} spellCheck={false} />
        </label>
        <label className="field">
          <span>Default model</span>
          {models.length > 0 ? (
            <select value={d.defaultModel} onChange={(e) => set("defaultModel", e.target.value)}>
              <option value="">None (agents must pick one)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label ?? m.id}
                </option>
              ))}
            </select>
          ) : (
            <input value={d.defaultModel} onChange={(e) => set("defaultModel", e.target.value)} placeholder="model id" />
          )}
        </label>
      </div>
      <p className="hint" id="custom-id-hint">
        Agents pick it as <code>custom:{id || "<id>"}</code>.{" "}
        {d.engine === "openai"
          ? "Needs the Codex CLI installed and an endpoint that serves /responses (Codex no longer speaks chat/completions)."
          : "Sent as ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY to the Agent SDK process only."}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm">
          {editing ? "Save provider" : "Add provider"}
        </button>
      </div>
    </form>
  );
}

export interface ProvidersPanelProps {
  order: Provider[];
  setOrder: (next: Provider[]) => void;
  failover: Set<string>;
  setFailover: (next: Set<string>) => void;
}

/** Settings > Providers: the one provider order, built-in provider cards with keys, and custom providers. */
export function ProvidersPanel({ order, setOrder, failover, setFailover }: ProvidersPanelProps) {
  const providers = useStore((s) => s.providers);
  const cfg = useStore((s) => s.providerConfig);
  const send = useStore((s) => s.send);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [switchProvider, setSwitchProvider] = useState<Provider | null>(null);
  const statusOf = (p: Provider): ProviderStatus => providers.find((s) => s.provider === p) ?? { provider: p, ok: false, reason: "Not registered yet" };
  const custom = cfg?.customProviders ?? [];
  const move = (i: number, delta: -1 | 1) => {
    const next = [...order];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
  };
  const builtins = order.filter((p) => !isCustomProvider(p));

  return (
    <div className="settings-panel">
      <section className="settings-section" aria-labelledby="order-head">
        <header>
          <h3 id="order-head">Provider order</h3>
          <p className="section-desc">
            One order for everything: <strong>Automatic</strong> uses the first available provider, failover tries the ticked ones in this order, and the header shows chips in
            this order.
          </p>
        </header>
        <ol className="order-list" aria-label="Provider order">
          {order.map((p, i) => (
            <OrderRow
              key={p}
              status={statusOf(p)}
              index={i}
              count={order.length}
              failover={failover.has(p)}
              onFailover={(on) => {
                const next = new Set(failover);
                if (on) next.add(p);
                else next.delete(p);
                setFailover(next);
              }}
              onMove={(d) => move(i, d)}
            />
          ))}
        </ol>
      </section>

      <section className="settings-section" aria-labelledby="builtin-head">
        <header>
          <h3 id="builtin-head">Built-in providers</h3>
          <p className="section-desc">Keys are saved to ~/.agenticview/config.json and only ever passed to that provider's own process. Saving a key applies to the next run.</p>
        </header>
        <div className="provider-cards">
          {builtins.map((p) => {
            const st = statusOf(p);
            return (
              <article key={p} className="provider-card" aria-label={providerLabel(p)}>
                <div className="provider-card-head">
                  <span className={`chip-dot ${st.ok ? "dot-ok" : "dot-off"}`} aria-hidden="true" />
                  <h4>{providerLabel(p)}</h4>
                  <span className={`provider-card-state ${st.ok ? "state-ok" : "state-off"}`}>{st.ok ? "Ready" : "Unavailable"}</span>
                  {st.limit?.limited && <LimitChip limit={st.limit} onSwitch={() => setSwitchProvider(p)} />}
                </div>
                <p className="provider-card-note">{AUTH_NOTES[p]}</p>
                {!st.ok && st.reason && <p className="provider-card-reason">{st.reason}</p>}
                {isKeyed(p) && <KeyField provider={p} hasKey={Boolean(cfg?.providerKeys[p])} />}
                {st.limit?.limited && (
                  <button type="button" className="btn btn-xs btn-ghost" onClick={() => setSwitchProvider(p)} aria-label={`Switch all ${providerLabel(p)} agents`}>
                    Switch all agents
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="custom-head">
        <header className="section-head-row">
          <div>
            <h3 id="custom-head">Custom providers</h3>
            <p className="section-desc">
              Any OpenAI- or Anthropic-compatible endpoint (local servers, gateways, other vendors). They appear in every provider picker under “Custom”; changes apply to the next run,
              no restart needed.
            </p>
          </div>
          {editing !== "new" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing("new")}>
              + Add custom provider
            </button>
          )}
        </header>
        {editing === "new" && <CustomProviderForm existingIds={custom.map((c) => c.id)} onDone={() => setEditing(null)} />}
        {custom.length === 0 && editing !== "new" && <p className="empty-note">No custom providers yet.</p>}
        <ul className="custom-list">
          {custom.map((c) => {
            const ref = `custom:${c.id}` as Provider;
            const st = statusOf(ref);
            return (
              <li key={c.id} className="provider-card custom-card">
                {editing === c.id ? (
                  <CustomProviderForm initial={c} existingIds={custom.map((x) => x.id)} onDone={() => setEditing(null)} />
                ) : (
                  <>
                    <div className="provider-card-head">
                      <span className={`chip-dot ${st.ok ? "dot-ok" : "dot-off"}`} aria-hidden="true" />
                      <h4>{c.label}</h4>
                      <code className="custom-id">custom:{c.id}</code>
                      <span className={`provider-card-state ${st.ok ? "state-ok" : "state-off"}`}>{st.ok ? "Ready" : "Unavailable"}</span>
                    </div>
                    <dl className="custom-meta">
                      <dt>API</dt>
                      <dd>{c.engine === "openai" ? "OpenAI-compatible (Codex CLI)" : "Anthropic-compatible (Agent SDK)"}</dd>
                      <dt>Base URL</dt>
                      <dd className="mono">{c.baseUrl}</dd>
                      <dt>Key</dt>
                      <dd>
                        <span className={`key-state ${c.hasKey ? "key-set" : "key-unset"}`}>{c.hasKey ? "set" : "not set"}</span>
                      </dd>
                      <dt>Models</dt>
                      <dd>{c.models.length ? c.models.map((m) => (m.id === c.defaultModel ? `${m.label ?? m.id} (default)` : m.label ?? m.id)).join(", ") : c.defaultModel ?? "none listed"}</dd>
                    </dl>
                    {!st.ok && st.reason && <p className="provider-card-reason">{st.reason}</p>}
                    <div className="custom-actions">
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditing(c.id)} aria-label={`Edit ${c.label}`}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-danger"
                        aria-label={`Remove ${c.label}`}
                        onClick={() => {
                          if (window.confirm(`Remove ${c.label}? Agents on it fall back to an error until moved.`)) send({ type: "customProvider.remove", id: c.id });
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {switchProvider && <SwitchProviderModal fromProvider={switchProvider} onClose={() => setSwitchProvider(null)} />}
    </div>
  );
}
