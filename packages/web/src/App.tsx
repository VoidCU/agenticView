import { useEffect, useState } from "react";
import { useStore } from "./state/store";
import { connect, getToken } from "./net/ws";
import { Office } from "./scene/Office";
import { TopBar } from "./hud/TopBar";
import { TaskBoard } from "./hud/TaskBoard";
import { Inbox } from "./hud/Inbox";
import { ChatPanel } from "./hud/ChatPanel";
import { CommandBar } from "./hud/CommandBar";
import { PermissionToast } from "./hud/PermissionToast";
import { QuestionToast } from "./hud/QuestionToast";
import { CreateAgentModal } from "./hud/CreateAgentModal";
import { SettingsModal } from "./hud/SettingsModal";
import { SessionsModal } from "./hud/sessions";
import { Timeline } from "./hud/Timeline";
import { ProjectsPanel } from "./hub/HubView";
import { CloseIcon } from "./hud/ui";
import { useDesktopNotifications } from "./hud/useNotifications";

type Modal = "create" | "settings" | "sessions" | "inbox" | undefined;
type Tab = "office" | "tasks" | "chat";

/** Keyboard shortcuts hint overlay */
function ShortcutsHint({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "?") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="shortcuts-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="shortcuts-card" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-head">
          <h3>Keyboard shortcuts</h3>
          <button type="button" className="icon-btn icon-btn-xs" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <dl className="shortcuts-list">
          <dt><kbd>I</kbd></dt><dd>Open Inbox</dd>
          <dt><kbd>T</kbd></dt><dd>Toggle Tasks panel</dd>
          <dt><kbd>L</kbd></dt><dd>Toggle Timeline</dd>
          <dt><kbd>?</kbd></dt><dd>Show this help</dd>
          <dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>Focus room (scene)</dd>
          <dt><kbd>Esc</kbd></dt><dd>Deselect / close</dd>
        </dl>
      </div>
    </div>
  );
}

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
  const [showTimeline, setShowTimeline] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const hasToken = Boolean(getToken());
  const world = useStore((s) => s.world);
  const connected = useStore((s) => s.connected);
  const selected = useStore((s) => s.selectedAgentId);

  // Desktop notifications
  useDesktopNotifications();

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

  useEffect(() => {
    const handleOpenInbox = () => setModal("inbox");
    window.addEventListener("agenticview:open-inbox", handleOpenInbox);
    return () => window.removeEventListener("agenticview:open-inbox", handleOpenInbox);
  }, []);

  // Keyboard shortcuts: I=Inbox, T=Tasks, L=Timeline, ?=help
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip when typing in inputs/textareas/selects or contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "i":
        case "I":
          e.preventDefault();
          setModal((m) => (m === "inbox" ? undefined : "inbox"));
          break;
        case "t":
        case "T":
          e.preventDefault();
          setTasksCollapsed((c) => !c);
          break;
        case "l":
        case "L":
          e.preventDefault();
          setShowTimeline((v) => !v);
          break;
        case "?":
          e.preventDefault();
          setShowShortcuts((v) => !v);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!hasToken) return <NoToken />;

  const hub = world?.kind === "hub";
  return (
    <div className="app" data-tab={tab}>
      <Office onCreate={() => setModal("create")} />
      <div className="hud">
        <TopBar
          onSettings={() => setModal("settings")}
          onCreate={() => setModal("create")}
          onSessions={() => setModal("sessions")}
          onInbox={() => setModal("inbox")}
          onTimeline={() => setShowTimeline((v) => !v)}
          timelineActive={showTimeline}
        />
        <div className="hud-left">
          {hub && <ProjectsPanel />}
          <TaskBoard onOpenInbox={() => setModal("inbox")} externalCollapsed={tasksCollapsed} onCollapseChange={setTasksCollapsed} />
        </div>
        <div className="hud-right">
          <ChatPanel />
        </div>
        {showTimeline && (
          <div className="hud-timeline">
            <Timeline onClose={() => setShowTimeline(false)} />
          </div>
        )}
        <div className="hud-bottom">
          <CommandBar />
          <nav className="tabs" aria-label="Panels">
            {(["office", "tasks", "chat"] as Tab[]).map((t) => (
              <button key={t} type="button" className={`tab ${tab === t ? "tab-on" : ""}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t === "office" ? "Office" : t === "tasks" ? (hub ? "Projects & Tasks" : "Tasks") : "Chat"}
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
      {modal === "sessions" && <SessionsModal onClose={() => setModal(undefined)} />}
      {modal === "inbox" && <Inbox onClose={() => setModal(undefined)} />}
      {showShortcuts && <ShortcutsHint onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
