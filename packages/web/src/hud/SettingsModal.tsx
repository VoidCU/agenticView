import { useState, type FormEvent } from "react";
import type { Provider } from "@agenticview/shared";
import { useStore } from "../state/store";
import { Modal, ProviderChip, providerLabel } from "./ui";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const providers = useStore((s) => s.providers);
  const send = useStore((s) => s.send);
  const world = useStore((s) => s.world);
  const [provider, setProvider] = useState<Provider | "">(settings?.defaultProvider ?? "");
  const [model, setModel] = useState(settings?.defaultModel ?? "");
  const [max, setMax] = useState(settings?.maxConcurrentRuns ?? 3);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send({
      type: "settings.update",
      settings: { defaultProvider: provider || null, defaultModel: model.trim() || null, maxConcurrentRuns: Math.min(10, Math.max(1, Math.round(max))) },
    });
    onClose();
  };

  const claude = providers.find((p) => p.provider === "claude");
  return (
    <Modal title={world?.kind === "hub" ? "Hub settings" : "Project settings"} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span>Default provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider | "")}>
              <option value="">Automatic (Claude)</option>
              {providers.map((p) => (
                <option key={p.provider} value={p.provider} disabled={!p.ok} title={p.ok ? undefined : p.reason}>
                  {providerLabel(p.provider)}
                  {p.ok ? "" : " (unavailable)"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Default model</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="provider default" autoComplete="off" />
          </label>
          <label className="field">
            <span>Workers running at once</span>
            <input type="number" min={1} max={10} value={max} onChange={(e) => setMax(Number(e.target.value))} />
          </label>
        </div>

        <fieldset className="field-set">
          <legend>Providers on this machine</legend>
          <ul className="provider-list">
            {providers.map((p) => (
              <li key={p.provider}>
                <ProviderChip status={p} />
                <span className="provider-reason">{p.ok ? "Ready" : p.reason ?? "Unavailable"}</span>
              </li>
            ))}
          </ul>
          {claude && !claude.ok && (
            <p className="hint">
              Claude agents need an API key. Set <code>ANTHROPIC_API_KEY</code> in the environment that starts AgenticView, then reopen the office.
            </p>
          )}
          {claude?.ok && (
            <p className="hint">
              Claude agents use <code>ANTHROPIC_API_KEY</code> from the environment that started AgenticView.
            </p>
          )}
        </fieldset>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save settings
          </button>
        </div>
      </form>
    </Modal>
  );
}
