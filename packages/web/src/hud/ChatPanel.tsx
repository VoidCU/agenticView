import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { EFFORT_LABELS, effectiveEffort, modelLabel, type Agent, type RunEvent } from "@agenticview/shared";
import { useStore, useAgentStatus, type FeedItem } from "../state/store";
import { uploadImage } from "../net/ws";
import { AgentMenu } from "./AgentMenu";
import { LimitChip, SwitchAgentModal } from "./LimitChip";
import { ServingChip, SessionChip, SessionNotice } from "./sessions";
import { WorkLog } from "./WorkLog";
import { ImageIcon, SendIcon, basename, defaultProviderOf, prettyInput, providerLabel, xpProgress } from "./ui";

interface Attachment {
  name: string;
  path?: string;
  error?: string;
}

const STATUS_WORD = { idle: "Idle", thinking: "Thinking", editing: "Editing", waiting: "Waiting on you", error: "Hit an error" } as const;

function EventLine({ event }: { event: RunEvent }) {
  switch (event.type) {
    case "text":
      return <div className="msg msg-agent">{event.text}</div>;
    case "tool_start":
      return (
        <div className="evt evt-tool">
          <span className="evt-icon" aria-hidden="true">⚙</span>
          <code>{event.name}</code>
          <span className="evt-detail">{prettyInput(event.name, event.input)}</span>
        </div>
      );
    case "tool_end":
      return (
        <div className={`evt evt-tool-end ${event.ok ? "" : "evt-bad"}`}>
          <span className="evt-icon" aria-hidden="true">{event.ok ? "✓" : "✕"}</span>
          <code>{event.name}</code>
          <span className="evt-detail">{event.summary}</span>
        </div>
      );
    case "file_changed":
      return (
        <div className="evt evt-file">
          <span className="evt-icon" aria-hidden="true">✎</span>
          <code title={event.path}>{basename(event.path)}</code>
          <span className="evt-detail">{event.kind}</span>
        </div>
      );
    case "permission":
      return (
        <div className="evt evt-perm">
          <span className="evt-icon" aria-hidden="true">?</span>
          <code>{event.tool}</code>
          <span className="evt-detail">asked for permission</span>
        </div>
      );
    case "status":
      return <div className="evt evt-status">{event.text}</div>;
    default:
      return null;
  }
}

function Feed({ items }: { items: FeedItem[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [items.length]);
  return (
    <div className="feed" role="log" aria-live="polite">
      {items.length === 0 && <p className="empty">Nothing yet. Say hello, or paste a screenshot to talk about it.</p>}
      {items.map((it, i) =>
        "user" in it ? (
          <div key={i} className="msg msg-user">
            {it.user}
          </div>
        ) : (
          <EventLine key={i} event={it.event} />
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

function Header({ agent }: { agent: Agent }) {
  const status = useAgentStatus(agent.id);
  const providers = useStore((s) => s.providers);
  const settings = useStore((s) => s.settings);
  const autoProvider = useStore((s) => s.autoProvider);
  const provider = agent.provider ?? defaultProviderOf(settings?.defaultProvider, autoProvider);
  const pstat = providers.find((p) => p.provider === provider);
  const chipEffort = effectiveEffort(provider, agent.model, agent.effort);
  const { pct, next } = xpProgress(agent.stats.xp, agent.stats.level);
  const [switchOpen, setSwitchOpen] = useState(false);
  return (
    <div className="chat-head">
      <span className="avatar" style={{ background: agent.appearance.color }} aria-hidden="true">
        <span className={`avatar-eyes eyes-${agent.appearance.eyes}`} />
      </span>
      <div className="chat-ident">
        <h2>{agent.name}</h2>
        <div className="chat-sub">
          <span>{agent.specialty || (agent.role === "manager" ? "Manager" : "Worker")}</span>
          <span className={`chip ${pstat && !pstat.ok ? "chip-off" : "chip-ok"}`} title={pstat?.ok === false ? pstat.reason : undefined}>
            <span className="chip-dot" aria-hidden="true" />
            {providerLabel(provider)}
            {agent.model ? ` · ${modelLabel(provider, agent.model)}` : ""}
            {chipEffort ? ` · ${EFFORT_LABELS[chipEffort]} effort` : ""}
          </span>
          {provider === "claude-session" && <SessionChip agent={agent} />}
          {provider === "claude-session" && <ServingChip agent={agent} />}
          {agent.limit?.limited && (
            <LimitChip limit={agent.limit} onSwitch={() => setSwitchOpen(true)} />
          )}
          <span className={`status status-${status}`}>{STATUS_WORD[status]}</span>
        </div>
        <div className="xp" title={`${agent.stats.xp} xp, ${next - agent.stats.xp} to the next level`}>
          <span className="xp-level">Lv {agent.stats.level}</span>
          <span className="xp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level">
            <span className="xp-fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="xp-num">{agent.stats.tasksDone} done</span>
        </div>
      </div>
      <AgentMenu agent={agent} />
      {switchOpen && (
        <SwitchAgentModal
          agentId={agent.id}
          agentName={agent.name}
          currentProvider={agent.provider}
          currentModel={agent.model}
          onClose={() => setSwitchOpen(false)}
        />
      )}
    </div>
  );
}

export function ChatPanel({ collapsed = false, onCollapseChange }: { collapsed?: boolean; onCollapseChange?: (value: boolean) => void }) {
  const selectedId = useStore((s) => s.selectedAgentId);
  const agent = useStore((s) => (s.selectedAgentId ? s.agents[s.selectedAgentId] : undefined));
  const items = useStore((s) => (s.selectedAgentId ? s.feed[s.selectedAgentId] : undefined)) ?? [];
  const sendChat = useStore((s) => s.sendChat);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setText("");
    setAttachments([]);
  }, [selectedId]);

  const addFiles = useCallback((files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(f.name));
    if (images.length === 0) return;
    for (const file of images) {
      const name = file.name || `pasted-${Date.now()}.png`;
      setAttachments((a) => [...a, { name }]);
      uploadImage(file)
        .then((path) => setAttachments((a) => a.map((x) => (x.name === name && !x.path && !x.error ? { ...x, path } : x))))
        .catch((e: Error) => setAttachments((a) => a.map((x) => (x.name === name && !x.path ? { ...x, error: e.message } : x))));
    }
  }, []);

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const data = e.clipboardData;
    if (!data) return;
    const files: File[] = [];
    const list = data.files ? Array.from(data.files as ArrayLike<File>) : [];
    files.push(...list);
    if (files.length === 0 && data.items) {
      for (const item of Array.from(data.items as ArrayLike<DataTransferItem>)) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer?.files ?? []));
  };

  const submit = () => {
    if (!agent) return;
    const trimmed = text.trim();
    const pending = attachments.some((a) => !a.path && !a.error);
    if (!trimmed || pending) return;
    sendChat(agent.id, trimmed, attachments.filter((a) => a.path).map((a) => a.path!));
    setText("");
    setAttachments([]);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  if (collapsed) return <button type="button" className="panel-tab panel-tab-chat" aria-expanded="false" onClick={() => onCollapseChange?.(false)}>Chat <span aria-hidden="true">‹</span></button>;

  if (!agent) {
    return (
      <aside className="panel panel-chat" aria-label="Chat">
        <div className="panel-head">
          <h2>Chat</h2>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onCollapseChange?.(true)} aria-label="Collapse chat">Collapse</button>
        </div>
        <div className="panel-body">
          <p className="empty">Click a robot to talk to it. The manager plans and delegates; workers do the coding.</p>
        </div>
      </aside>
    );
  }

  const uploading = attachments.some((a) => !a.path && !a.error);
  return (
    <aside className="panel panel-chat" aria-label={`Chat with ${agent.name}`} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <button type="button" className="chat-collapse btn btn-ghost btn-xs" onClick={() => onCollapseChange?.(true)} aria-label="Collapse chat">Collapse</button>
      <Header agent={agent} />
      <SessionNotice agent={agent} />
      <WorkLog agent={agent} />
      <Feed items={items} />
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {attachments.length > 0 && (
          <ul className="attachments">
            {attachments.map((a, i) => (
              <li key={i} className={`attachment ${a.error ? "attachment-bad" : a.path ? "" : "attachment-pending"}`} title={a.error ?? a.path ?? "Uploading"}>
                <ImageIcon />
                <span>{a.name}</span>
                <button type="button" className="icon-btn icon-btn-xs" aria-label={`Remove ${a.name}`} onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="composer-row">
          <textarea
            aria-label={`Message ${agent.name}`}
            placeholder={agent.role === "manager" ? `Ask ${agent.name} to plan something…` : `Message ${agent.name}…`}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button type="button" className="icon-btn" aria-label="Attach image" title="Attach an image (or paste one)" onClick={() => fileInput.current?.click()}>
            <ImageIcon />
          </button>
          <button type="submit" className="icon-btn icon-btn-primary" aria-label="Send" disabled={!text.trim() || uploading} title={uploading ? "Waiting for the upload" : "Send (Enter)"}>
            <SendIcon />
          </button>
        </div>
      </form>
    </aside>
  );
}
