import { useEffect, useState } from "react";
import { useStore } from "./state/store";
import { connect, getToken } from "./net/ws";
import { Office } from "./scene/Office";
import { TopBar } from "./hud/TopBar";
import { TaskBoard } from "./hud/TaskBoard";
import { ChatPanel } from "./hud/ChatPanel";
import { CommandBar } from "./hud/CommandBar";
import { PermissionToast } from "./hud/PermissionToast";
import { QuestionToast } from "./hud/QuestionToast";
import { CreateAgentModal } from "./hud/CreateAgentModal";
import { SettingsModal } from "./hud/SettingsModal";
import { ProjectsPanel } from "./hub/HubView";
import { CloseIcon } from "./hud/ui";

type Modal = "create" | "settings" | undefined;
type Tab = "office" | "tasks" | "chat";

function ErrorToasts() {
  const errors = useStore((s) => s.errors);
  const dismiss = useStore((s) => s.dismissError);
  const visible = errors.filter((e) => e.ref !== "agent.create" && e.ref !== "agent.update");
  useEffect(() => {
    if (visible.length === 0) return;
    const t = setTimeout(() => dismiss(visible[0]!.id), 8000);
    return () => clearTimeout(t);
  }, [visible, dismiss]);
  if (visible.length === 0) return null;
  return (
    <div className="toasts toasts-error" aria-live="polite">
      {visible.map((e) => (
        <div key={e.id} className="toast toast-error" role="alert">
          <div className="toast-body">
            {e.ref && <code>{e.ref}</code>} {e.message}
          </div>
          <button type="button" className="icon-btn icon-btn-xs" aria-label="Dismiss" onClick={() => dismiss(e.id)}>
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

function NoToken() {
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>AgenticView needs its launch link</h1>
        <p>Open the address the CLI printed, the one ending in <code>#token=…</code>. It carries the access token for this office.</p>
        <p>From Claude Code, run <code>/agenticview</code> in a project to get a fresh link.</p>
      </div>
    </div>
  );
}

export function App() {
  const [modal, setModal] = useState<Modal>();
  const [tab, setTab] = useState<Tab>("office");
  const hasToken = Boolean(getToken());
  const world = useStore((s) => s.world);
  const connected = useStore((s) => s.connected);
  const selected = useStore((s) => s.selectedAgentId);

  useEffect(() => {
    if (!hasToken) return;
    const conn = connect(useStore);
    const timer = setInterval(() => useStore.getState().tick(), 250);
    return () => {
      conn.close();
      clearInterval(timer);
    };
  }, [hasToken]);

  // Selecting a robot on a narrow screen jumps to the chat tab so the selection is visible.
  useEffect(() => {
    if (selected && window.innerWidth < 900) setTab("chat");
  }, [selected]);

  if (!hasToken) return <NoToken />;

  const hub = world?.kind === "hub";
  return (
    <div className="app" data-tab={tab}>
      <Office onCreate={() => setModal("create")} />
      <div className="hud">
        <TopBar onSettings={() => setModal("settings")} onCreate={() => setModal("create")} />
        <div className="hud-left">
          {hub && <ProjectsPanel />}
          <TaskBoard />
        </div>
        <div className="hud-right">
          <ChatPanel />
        </div>
        <div className="hud-bottom">
          <CommandBar />
          <nav className="tabs" aria-label="Panels">
            {(["office", "tasks", "chat"] as Tab[]).map((t) => (
              <button key={t} type="button" className={`tab ${tab === t ? "tab-on" : ""}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t === "office" ? "Office" : t === "tasks" ? (hub ? "Projects" : "Tasks") : "Chat"}
              </button>
            ))}
          </nav>
        </div>
      </div>
      {!connected && world && (
        <div className="banner" role="status">
          Reconnecting to the office…
        </div>
      )}
      {!world && connected === false && (
        <div className="banner banner-quiet" role="status">
          Connecting…
        </div>
      )}
      <PermissionToast />
      <QuestionToast />
      <ErrorToasts />
      {modal === "create" && <CreateAgentModal onClose={() => setModal(undefined)} />}
      {modal === "settings" && <SettingsModal onClose={() => setModal(undefined)} />}
    </div>
  );
}
