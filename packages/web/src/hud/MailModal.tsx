import { useEffect, useMemo, useState } from "react";
import type { MailAccount, MailThread } from "@agenticview/shared";
import { MailApiError, useMail, type ThreadFilter } from "../state/mail";
import { useStore } from "../state/store";
import { Modal } from "./ui";
import { PRIVACY_NOTICE } from "./GmailConnections";
import { MailSources } from "./MailSources";
import { MailThreadView } from "./MailThreadView";
import { mailDate, senderName, type MailRun } from "./mailFormat";

export type MailView = "threads" | "sources";

const NO_ACCOUNTS: readonly MailAccount[] = [];

function MailError({ error, onDismiss }: { error: unknown; onDismiss: () => void }) {
  const accounts = useMail((s) => s.status?.accounts);
  if (error instanceof MailApiError && error.needsReconnect) {
    const email = accounts?.find((a) => a.id === error.accountId)?.email ?? "your Gmail account";
    return (
      <div className="mail-error" role="alert">
        <span>Reconnect {email} in Settings → Connections</span>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => window.dispatchEvent(new CustomEvent("agenticview:open-settings", { detail: { tab: "connections" } }))}
        >
          Open Connections
        </button>
      </div>
    );
  }
  return (
    <div className="mail-error" role="alert">
      <span>{error instanceof Error ? error.message : "Something went wrong"}</span>
      <button type="button" className="btn btn-ghost btn-xs" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function lastMessage(t: MailThread) {
  return t.messages[t.messages.length - 1];
}

function ThreadList({ run, onOpen, onClose }: { run: MailRun; onOpen: (key: string) => void; onClose: () => void }) {
  const threads = useMail((s) => s.threads);
  const tags = useMail((s) => s.tags);
  const sources = useMail((s) => s.sources);
  const accounts = useMail((s) => s.status?.accounts) ?? NO_ACCOUNTS;
  const filter = useMail((s) => s.threadFilter);
  const tasks = useStore((s) => s.tasks);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // Labels seen so far, so picking one does not shrink its own option list.
  const [seenLabels, setSeenLabels] = useState<string[]>([]);
  useEffect(() => {
    setSeenLabels((prev) => {
      const next = new Set(prev);
      threads.forEach((t) => t.gmailLabels.forEach((l) => next.add(l)));
      return next.size === prev.length ? prev : [...next].sort();
    });
  }, [threads]);
  const senders = useMemo(() => [...new Set(sources.flatMap((s) => s.senders))].sort(), [sources]);
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const applyFilter = (patch: Partial<ThreadFilter>) => {
    const next: ThreadFilter = { ...filter, ...patch };
    for (const k of Object.keys(next) as (keyof ThreadFilter)[]) if (!next[k]) delete next[k];
    setSelected([]);
    void run(() => useMail.getState().loadThreads(next));
  };

  const toggle = (key: string, on: boolean) => setSelected((s) => (on ? [...s, key] : s.filter((k) => k !== key)));

  const send = async () => {
    setBusy(true);
    setSent(undefined);
    const keys = selected;
    const ok = await run(async () => {
      await useMail.getState().sendToAtlas(keys, note.trim() || undefined);
      await useMail.getState().loadThreads();
    });
    if (ok) {
      setSelected([]);
      setNote("");
      setSent(`Sent ${keys.length} thread${keys.length === 1 ? "" : "s"} to Atlas.`);
    }
    setBusy(false);
  };

  const openTask = (taskId: string) => {
    const task = tasks[taskId];
    if (!task) return;
    useStore.getState().select(task.assigneeId ?? task.createdBy);
    onClose();
  };

  return (
    <div className="mail-threads">
      <aside className="mail-filters" aria-label="Thread filters">
        <label className="mail-field">
          <span>Account</span>
          <select value={filter.accountId ?? ""} onChange={(e) => applyFilter({ accountId: e.target.value })}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.email}</option>
            ))}
          </select>
        </label>
        <label className="mail-field">
          <span>Sender</span>
          <select value={filter.sender ?? ""} onChange={(e) => applyFilter({ sender: e.target.value })}>
            <option value="">All senders</option>
            {senders.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="mail-field">
          <span>Tag</span>
          <select value={filter.tag ?? ""} onChange={(e) => applyFilter({ tag: e.target.value })}>
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="mail-field">
          <span>Gmail label</span>
          <select value={filter.label ?? ""} onChange={(e) => applyFilter({ label: e.target.value })}>
            <option value="">All labels</option>
            {seenLabels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="mail-check">
          <input type="checkbox" checked={!!filter.notSent} onChange={(e) => applyFilter({ notSent: e.target.checked })} />
          <span>Not yet sent to Atlas</span>
        </label>
      </aside>

      <div className="mail-list">
        {threads.length === 0 ? (
          <p className="hint">No threads yet. Pick senders under Sources and pull their mail.</p>
        ) : (
          <ul className="mail-rows">
            {threads.map((t) => {
              const last = lastMessage(t);
              const sentTo = t.sentToAtlas[t.sentToAtlas.length - 1];
              return (
                <li key={t.id} className={`mail-row${selected.includes(t.id) ? " mail-row-on" : ""}`}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.subject}`}
                    checked={selected.includes(t.id)}
                    onChange={(e) => toggle(t.id, e.target.checked)}
                  />
                  <div className="mail-row-main">
                    <button type="button" className="link mail-row-subject" onClick={() => onOpen(t.id)}>
                      {t.subject || "(no subject)"}
                    </button>
                    <div className="mail-row-meta">
                      {last && <span>{senderName(last.from, last.fromEmail)}</span>}
                      {last && <span className="hint">{mailDate(last.date)}</span>}
                      {t.gmailLabels.map((l) => (
                        <span key={l} className="chip mail-label">{l}</span>
                      ))}
                      {t.tags.map((id) => {
                        const tag = tagById.get(id);
                        return tag ? (
                          <span key={id} className="chip mail-tag" style={{ borderColor: tag.color }}>
                            <span className="chip-dot" style={{ background: tag.color }} aria-hidden="true" />
                            {tag.name}
                          </span>
                        ) : null;
                      })}
                      {sentTo && (
                        <button
                          type="button"
                          className="chip mail-sent"
                          title={tasks[sentTo.taskId] ? `Task: ${tasks[sentTo.taskId]!.title}` : "Sent to Atlas"}
                          disabled={!tasks[sentTo.taskId]}
                          onClick={() => openTask(sentTo.taskId)}
                        >
                          Sent to Atlas
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mail-atlas">
          <input
            aria-label="Note for Atlas"
            placeholder="Optional note for Atlas"
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || selected.length === 0 || selected.length > 20} onClick={() => void send()}>
            Send to Atlas
          </button>
        </div>
        <p className="hint">
          {selected.length > 20 ? "Send at most 20 threads at a time. " : ""}
          {PRIVACY_NOTICE}
        </p>
        {sent && <p className="hint" role="status">{sent}</p>}
      </div>
    </div>
  );
}

/** The Mail view: pick Gmail senders, browse pulled threads, send them to Atlas and act on reply drafts. */
export function MailModal({ onClose, initialView = "threads", initialAccountId }: { onClose: () => void; initialView?: MailView; initialAccountId?: string }) {
  const [view, setView] = useState<MailView>(initialView);
  const [openKey, setOpenKey] = useState<string | undefined>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    void useMail.getState().refresh();
  }, []);

  const run: MailRun = async (fn) => {
    setError(undefined);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };

  const tabs: { id: MailView; label: string }[] = [
    { id: "threads", label: "Threads" },
    { id: "sources", label: "Sources" },
  ];

  return (
    <Modal title="Mail" onClose={onClose} wide className="settings-modal mail-modal">
      <div className="settings-tabs" role="tablist" aria-label="Mail sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={view === t.id}
            className={`tab ${view === t.id ? "tab-on" : ""}`}
            onClick={() => {
              setView(t.id);
              setOpenKey(undefined);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error !== undefined && <MailError error={error} onDismiss={() => setError(undefined)} />}
      <div className="settings-body mail-body" role="tabpanel">
        {view === "sources" ? (
          <MailSources run={run} initialAccountId={initialAccountId} />
        ) : openKey ? (
          <MailThreadView threadKey={openKey} run={run} onBack={() => setOpenKey(undefined)} />
        ) : (
          <ThreadList run={run} onOpen={setOpenKey} onClose={onClose} />
        )}
      </div>
    </Modal>
  );
}
