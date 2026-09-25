import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { PALETTE, type Agent, type ClientMessage, type PermissionMode, type Provider, type Scope, type ToolAllowance } from "@agenticview/shared";
import { useStore } from "../state/store";
import { Modal, automaticLabel, defaultProviderOf, providerLabel } from "./ui";
import { modeHint } from "./modeHint";

const TOOL_LABELS: { key: keyof ToolAllowance; label: string; hint: string }[] = [
  { key: "edit", label: "Edit files", hint: "Read and write files in the project" },
  { key: "shell", label: "Shell", hint: "Run commands such as tests and builds" },
  { key: "web", label: "Web", hint: "Fetch pages and search the web" },
  { key: "screenshot", label: "Screenshot", hint: "Capture a page in a headless browser" },
];
const MODES: { value: PermissionMode; label: string; hint: string }[] = [
  { value: "ask", label: "Ask before every tool", hint: "You approve each command and edit" },
  { value: "auto-edit", label: "Edits are fine, ask for the rest", hint: "File edits go through; shell and web still ask" },
  { value: "auto", label: "Fully automatic", hint: "Never asks; best for trusted, sandboxed work" },
];
const EYES: Agent["appearance"]["eyes"][] = ["round", "visor", "dots"];

interface Props {
  onClose: () => void;
  /** When set, the form edits this agent and sends `agent.update` instead of `agent.create`. */
  edit?: Agent;
}

export function CreateAgentModal({ onClose, edit }: Props) {
  const send = useStore((s) => s.send);
  const providers = useStore((s) => s.providers);
  const settings = useStore((s) => s.settings);
  const autoProvider = useStore((s) => s.autoProvider);
  const world = useStore((s) => s.world);
  const agents = useStore((s) => s.agents);
  const errors = useStore((s) => s.errors);
  const hub = world?.kind === "hub";
  const uid = useId();

  const [name, setName] = useState(edit?.name ?? "");
  const [specialty, setSpecialty] = useState(edit?.specialty ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [provider, setProvider] = useState<Provider | "">(edit?.provider ?? "");
  const [model, setModel] = useState(edit?.model ?? "");
  const [tools, setTools] = useState<ToolAllowance>(edit?.tools ?? { edit: true, shell: true, web: false, screenshot: false });
  const [mode, setMode] = useState<PermissionMode>(edit?.permissionMode ?? "auto-edit");
  const [scope, setScope] = useState<Scope>(edit?.scope ?? (hub ? "global" : "project"));
  const [color, setColor] = useState<string>(edit?.appearance.color ?? PALETTE[Object.keys(agents).length % PALETTE.length]!);
  const [eyes, setEyes] = useState<Agent["appearance"]["eyes"]>(edit?.appearance.eyes ?? "round");
  const [submittedAt, setSubmittedAt] = useState<number | undefined>();
  const idsAtSubmit = useRef<Set<string>>(new Set());

  const defaultProvider = defaultProviderOf(settings?.defaultProvider, autoProvider);
  const effectiveProvider: Provider = provider || defaultProvider;
  const error = submittedAt ? errors.find((e) => e.ref === (edit ? "agent.update" : "agent.create") && e.ts >= submittedAt) : undefined;

  useEffect(() => {
    if (!submittedAt) return;
    if (edit) {
      const current = agents[edit.id];
      if (current && current.updatedAt !== edit.updatedAt) onClose();
      return;
    }
    if (Object.keys(agents).some((id) => !idsAtSubmit.current.has(id))) onClose();
  }, [agents, submittedAt, edit, onClose]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const appearance = { color, accent: edit?.appearance.accent ?? "#ffffff", eyes };
    const msg: ClientMessage = edit
      ? {
          type: "agent.update",
          id: edit.id,
          patch: { name: trimmed, specialty: specialty.trim(), description: description.trim(), provider: provider || null, model: model.trim() || null, tools, permissionMode: mode, appearance },
        }
      : {
          type: "agent.create",
          agent: { name: trimmed, specialty: specialty.trim(), description: description.trim(), provider: provider || null, model: model.trim() || null, tools, permissionMode: mode, scope, appearance },
        };
    idsAtSubmit.current = new Set(Object.keys(agents));
    setSubmittedAt(Date.now());
    send(msg);
  };

  const busy = Boolean(submittedAt) && !error;
  return (
    <Modal title={edit ? `Edit ${edit.name}` : "New agent"} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="Nova" autoComplete="off" />
          </label>
          <label className="field">
            <span>Specialty</span>
            <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} maxLength={120} placeholder="Backend APIs, tests, design systems…" autoComplete="off" />
          </label>
          <label className="field field-full">
            <span>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this agent is good at, and anything it should always keep in mind." />
          </label>
          <label className="field">
            <span>Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider | "")}>
              <option value="">{settings?.defaultProvider ? `Default (${providerLabel(defaultProvider)})` : automaticLabel(autoProvider)}</option>
              {providers.map((p) => (
                <option key={p.provider} value={p.provider} disabled={!p.ok && p.provider !== "claude-session"} title={p.ok ? undefined : p.reason ?? "Unavailable"}>
                  {providerLabel(p.provider)}
                  {p.ok ? "" : p.provider === "claude-session" ? " (no worker yet)" : " (unavailable)"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="provider default" autoComplete="off" />
          </label>
        </div>

        <fieldset className="field-set">
          <legend>Tools</legend>
          <div className="choices">
            {TOOL_LABELS.map((t) => (
              <label key={t.key} className="choice" title={t.hint}>
                <input type="checkbox" checked={tools[t.key]} onChange={(e) => setTools({ ...tools, [t.key]: e.target.checked })} />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field-set">
          <legend>Permission mode</legend>
          <div className="choices choices-col">
            {MODES.map((m) => (
              <label key={m.value} className="choice" title={m.hint}>
                <input type="radio" name={`${uid}-mode`} checked={mode === m.value} onChange={() => setMode(m.value)} />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
          <p className="field-hint" data-testid="mode-hint">
            On {providerLabel(effectiveProvider)}: {modeHint(effectiveProvider, mode)}
          </p>
        </fieldset>

        {!edit && (
          <fieldset className="field-set">
            <legend>Scope</legend>
            <div className="choices">
              {!hub && (
                <label className="choice" title="Lives in this project's .agenticview folder">
                  <input type="radio" name={`${uid}-scope`} checked={scope === "project"} onChange={() => setScope("project")} />
                  <span>Project</span>
                </label>
              )}
              <label className="choice" title="Available from every project, in the lobby">
                <input type="radio" name={`${uid}-scope`} checked={scope === "global"} onChange={() => setScope("global")} />
                <span>Global</span>
              </label>
            </div>
          </fieldset>
        )}

        <fieldset className="field-set">
          <legend>Look</legend>
          <div className="swatches" role="radiogroup" aria-label="Colour">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Colour ${c}`}
                className={`swatch ${color === c ? "swatch-on" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <div className="choices">
            {EYES.map((e) => (
              <label key={e} className="choice">
                <input type="radio" name={`${uid}-eyes`} checked={eyes === e} onChange={() => setEyes(e)} />
                <span>{e === "round" ? "Round eyes" : e === "visor" ? "Visor" : "Dot eyes"}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {edit ? "Save changes" : "Create agent"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
