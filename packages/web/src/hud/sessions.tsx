import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  WORK_COMMAND,
  modelFamily,
  newSessionUri,
  resumeCommand,
  resumeSessionUri,
  sessionModelMatches,
  type Agent,
  type Provider,
  type WorkerSessionInfo,
} from "@agenticview/shared";
import { useStore } from "../state/store";
import { Modal, defaultProviderOf, timeAgo } from "./ui";

/** How long to wait for the browser to hand a vscode:// link to VS Code before offering a fallback. */
export const LAUNCH_FALLBACK_MS = 1600;

/** The provider an agent effectively runs on (its own, else the office default / Automatic). */
export function useAgentProvider(agent: Agent): Provider {
  const settings = useStore((s) => s.settings);
  const autoProvider = useStore((s) => s.autoProvider);
  return agent.provider ?? defaultProviderOf(settings?.defaultProvider, autoProvider);
}

/** The session record an agent is bound to (undefined when unbound or forgotten). */
export function boundSession(agent: Agent, sessions: WorkerSessionInfo[]): WorkerSessionInfo | undefined {
  return agent.session?.id ? sessions.find((s) => s.id === agent.session!.id) : undefined;
}

/** "Session X is on Sonnet 5; run /model opus in that session to switch", or undefined when they match. */
export function modelMismatchHint(requested: string | null | undefined, session: Pick<WorkerSessionInfo, "name" | "model"> | undefined): string | undefined {
  if (!requested || !session?.model || sessionModelMatches(requested, session.model)) return undefined;
  const alias = modelFamily(requested) ?? requested;
  return `Session "${session.name}" is on ${session.model}; run /model ${alias} in that session to switch.`;
}

/** Command a user types in a fresh terminal session when the VS Code link cannot open. */
export function newSessionCommand(agentName?: string): string {
  return agentName ? `${WORK_COMMAND} ${agentName}` : WORK_COMMAND;
}

/**
 * A vscode:// link that also notices when nothing handled it (no VS Code / no Claude Code
 * extension: the page never loses focus) and then shows a fallback with a command to copy.
 */
export function VsCodeLink({ uri, fallback, children, className = "btn btn-ghost btn-sm", title }: { uri: string; fallback: ReactNode; children: ReactNode; className?: string; title?: string }) {
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = (_e: MouseEvent<HTMLAnchorElement>) => {
    setFailed(false);
    clearTimeout(timer.current);
    const handled = () => {
      clearTimeout(timer.current);
      window.removeEventListener("blur", handled);
      document.removeEventListener("visibilitychange", handled);
    };
    window.addEventListener("blur", handled, { once: true });
    document.addEventListener("visibilitychange", handled, { once: true });
    timer.current = setTimeout(() => {
      handled();
      setFailed(true);
    }, LAUNCH_FALLBACK_MS);
  };
  return (
    <span className="launch">
      <a className={className} href={uri} onClick={onClick} title={title}>
        {children}
      </a>
      {failed && (
        <span className="launch-fallback" role="status">
          Nothing opened? VS Code with the Claude Code extension may not be installed. {fallback}
        </span>
      )}
    </span>
  );
}

function CopyCode({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-code">
      <code>{text}</code>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

/** "Open a Claude Code session for Nova": a new VS Code Claude tab with the worker command pre-filled. */
export function NewSessionLink({ agentName, label, className }: { agentName?: string; label?: string; className?: string }) {
  const projectPath = useStore((s) => s.world?.projectPath);
  return (
    <VsCodeLink
      uri={newSessionUri(agentName)}
      className={className}
      title="Opens a new Claude Code tab in VS Code with the worker command typed in. Press Enter there to connect it."
      fallback={
        <>
          Start <code>claude</code> in a terminal{projectPath ? <> in <code>{projectPath}</code></> : null} and run <CopyCode text={newSessionCommand(agentName)} />
        </>
      }
    >
      {label ?? (agentName ? `Open a Claude Code session for ${agentName}` : "New session")}
    </VsCodeLink>
  );
}

export function ResumeSessionLink({ session, className }: { session: Pick<WorkerSessionInfo, "id" | "name">; className?: string }) {
  return (
    <VsCodeLink
      uri={resumeSessionUri(session.id)}
      className={className}
      title={`Resume "${session.name}" in a VS Code Claude Code tab`}
      fallback={
        <>
          Resume it in a terminal: <CopyCode text={resumeCommand(session.id)} /> then run <code>{WORK_COMMAND}</code> if it is not polling.
        </>
      }
    >
      Open session
    </VsCodeLink>
  );
}

export const ENTER_HINT = "Press Enter in the new Claude Code tab to connect it. The prompt is typed in for you but never sent automatically.";

/** Small online dot + name, for chips and lists. */
export function SessionDot({ online }: { online: boolean }) {
  return <span className={`session-dot ${online ? "session-on" : "session-off"}`} aria-label={online ? "online" : "offline"} role="img" />;
}

/** Chat header chip for claude-session agents: bound session, online state and reported model. */
export function SessionChip({ agent }: { agent: Agent }) {
  const sessions = useStore((s) => s.sessions);
  const s = boundSession(agent, sessions);
  if (!agent.session || !s) {
    // Unbound, or bound to a session the office no longer knows (forgotten): any free session takes the work.
    return (
      <span className="chip chip-off" title="Any free Claude Code session picks up this agent's tasks; the first one to do so keeps it">
        <span className="chip-dot" aria-hidden="true" />
        Any free session
      </span>
    );
  }
  const name = s?.name ?? agent.session.name ?? agent.session.id.slice(0, 8);
  const online = Boolean(s?.online);
  return (
    <span className={`chip ${online ? "chip-ok" : "chip-off"}`} title={`Claude Code session ${agent.session.id}${s?.model ? ` on ${s.model}` : ""}`} data-testid="session-chip">
      <span className="chip-dot" aria-hidden="true" />
      <span className="chip-text">
        {name} · {online ? "online" : "offline"}
        {s?.model ? ` · ${s.model}` : ""}
      </span>
    </span>
  );
}

/** Banner in the chat when the agent's work waits on its (offline) session, plus model mismatch hint. */
export function SessionNotice({ agent }: { agent: Agent }) {
  const provider = useAgentProvider(agent);
  const sessions = useStore((s) => s.sessions);
  const tasks = useStore((s) => s.tasks);
  const send = useStore((s) => s.send);
  const s = boundSession(agent, sessions);
  const mismatch = modelMismatchHint(agent.model, s);
  const busy = Object.values(tasks).some((t) => t.assigneeId === agent.id && (t.status === "running" || t.status === "assigned" || t.status === "queued"));
  const waiting = busy && s && !s.online && !sessions.some((x) => x.currentTaskId && tasks[x.currentTaskId]?.assigneeId === agent.id);
  if (!waiting && !mismatch) return null;
  if (provider !== "claude-session") return null;
  const name = s?.name ?? agent.session?.name ?? agent.session?.id.slice(0, 8) ?? "";
  return (
    <div className="session-notice" role="status">
      {waiting && (
        <>
          <p>
            Waiting for session <strong>{name}</strong> (offline). Reopen it, or let another session take over.
          </p>
          <div className="session-actions">
            {agent.session && <ResumeSessionLink session={{ id: agent.session.id, name }} className="btn btn-primary btn-xs" />}
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => send({ type: "agent.update", id: agent.id, patch: { session: null } })}>
              Use any session
            </button>
            {sessions.filter((x) => x.id !== agent.session?.id).length > 0 && (
              <select
                aria-label="Move to session"
                className="select-xs"
                value=""
                onChange={(e) => {
                  const pick = sessions.find((x) => x.id === e.target.value);
                  if (pick) send({ type: "agent.update", id: agent.id, patch: { session: { id: pick.id, name: pick.name } } });
                }}
              >
                <option value="">Move to…</option>
                {sessions
                  .filter((x) => x.id !== agent.session?.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.online ? "online" : "offline"})
                    </option>
                  ))}
              </select>
            )}
          </div>
        </>
      )}
      {mismatch && <p className="session-mismatch">{mismatch}</p>}
    </div>
  );
}

function SessionRow({ s }: { s: WorkerSessionInfo }) {
  const send = useStore((st) => st.send);
  const agents = useStore((st) => st.agents);
  const tasks = useStore((st) => st.tasks);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const bound = s.agentIds.map((id) => agents[id]?.name).filter(Boolean);
  const task = s.currentTaskId ? tasks[s.currentTaskId] : undefined;
  return (
    <li className="session-row" data-session={s.id}>
      <div className="session-main">
        <SessionDot online={s.online} />
        {editing ? (
          <form
            className="session-rename"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) send({ type: "session.rename", id: s.id, name: name.trim() });
              setEditing(false);
            }}
          >
            <input aria-label="Session name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
            <button type="submit" className="btn btn-primary btn-xs">
              Save
            </button>
          </form>
        ) : (
          <span className="session-name">{s.name}</span>
        )}
        <span className="session-model" title="Model the session reported (change it with /model in that session)">
          {s.model ?? "model unknown"}
        </span>
      </div>
      <div className="session-meta">
        <span>{s.online ? "online" : `last seen ${timeAgo(s.lastSeen)}`}</span>
        <span>{bound.length ? `serves ${bound.join(", ")}` : "no agents bound"}</span>
        {task && <span>working on “{task.title}”</span>}
        {s.cwd && <span title={s.cwd}>{s.cwd}</span>}
      </div>
      <div className="session-actions">
        <ResumeSessionLink session={s} className="btn btn-ghost btn-xs" />
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditing((v) => !v)}>
          Rename
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => {
            if (window.confirm(`Forget "${s.name}"? Agents bound to it go back to "Any free session".`)) send({ type: "session.forget", id: s.id });
          }}
        >
          Forget
        </button>
      </div>
    </li>
  );
}

export function SessionsModal({ onClose }: { onClose: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const agents = useStore((s) => s.agents);
  const [forAgent, setForAgent] = useState("");
  const sessionAgents = Object.values(agents).filter((a) => a.provider === "claude-session");
  return (
    <Modal title="Claude Code sessions" onClose={onClose} wide>
      <p className="hint">
        Agents on the <strong>Claude Code session</strong> provider are served by your own Claude Code sessions running <code>{WORK_COMMAND}</code>. Each agent sticks to the
        session that served it (or the one named in the command) and its tasks wait for that session, even across restarts.
      </p>
      {sessions.length === 0 ? (
        <p className="empty">No session has connected yet.</p>
      ) : (
        <ul className="session-list" aria-label="Sessions">
          {sessions.map((s) => (
            <SessionRow key={s.id} s={s} />
          ))}
        </ul>
      )}
      <fieldset className="field-set">
        <legend>New session</legend>
        <div className="session-new">
          <label className="field">
            <span>For agent</span>
            <select value={forAgent} onChange={(e) => setForAgent(e.target.value)} aria-label="Agent for the new session">
              <option value="">Any agent</option>
              {sessionAgents.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <NewSessionLink agentName={forAgent || undefined} label="New session" className="btn btn-primary btn-sm" />
        </div>
        <p className="field-hint">{ENTER_HINT} A session keeps the model it was started with: switch it there with /model.</p>
      </fieldset>
    </Modal>
  );
}
