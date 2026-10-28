import { useEffect, useMemo, useRef, useState } from "react";
import type { MailDraft, MailThread } from "@agenticview/shared";
import { useMail } from "../state/mail";
import { useStore } from "../state/store";
import { CopyButton, markdownToPlainText } from "./markdown";
import { mailDate, senderName, type MailRun } from "./mailFormat";

/** Who a reply goes to: the newest message not sent by the account itself (as the server does). */
function replyTarget(t: MailThread, ownEmail: string | undefined): string {
  const own = ownEmail?.toLowerCase();
  const target = [...t.messages].reverse().find((m) => m.fromEmail.toLowerCase() !== own);
  return target?.fromEmail ?? "";
}

function replySubject(subject: string): string {
  const s = subject.trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

function TagPicker({ thread, run }: { thread: MailThread; run: MailRun }) {
  const tags = useMail((s) => s.tags);
  const agents = useStore((s) => s.agents);
  const workers = useMemo(() => Object.values(agents).filter((a) => a.role === "worker"), [agents]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#5b8cff");
  const [meaning, setMeaning] = useState("");
  const [agentId, setAgentId] = useState("");
  const [writeToGmail, setWriteToGmail] = useState(false);

  const toggle = (id: string, on: boolean) => {
    const next = on ? [...thread.tags, id] : thread.tags.filter((t) => t !== id);
    void run(() => useMail.getState().setTags(thread.id, next));
  };

  const create = async () => {
    const ok = await run(async () => {
      const tag = await useMail.getState().saveTag({
        name: name.trim(),
        color,
        meaning: meaning.trim(),
        ...(agentId ? { preferredAgentId: agentId } : {}),
        writeToGmail,
      });
      await useMail.getState().setTags(thread.id, [...thread.tags, tag.id]);
    });
    if (ok) {
      setAdding(false);
      setName("");
      setMeaning("");
      setAgentId("");
      setWriteToGmail(false);
    }
  };

  return (
    <div className="mail-tags" aria-label="Tags" role="group">
      {tags.map((t) => (
        <label key={t.id} className="chip mail-tag-pick" style={{ borderColor: t.color }} title={t.meaning || undefined}>
          <input type="checkbox" checked={thread.tags.includes(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} />
          <span className="chip-dot" style={{ background: t.color }} aria-hidden="true" />
          {t.name}
        </label>
      ))}
      {!adding ? (
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAdding(true)}>New tag</button>
      ) : (
        <div className="mail-newtag">
          <label className="mail-field">
            <span>Name</span>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="mail-field">
            <span>Colour</span>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label className="mail-field">
            <span>Meaning</span>
            <input value={meaning} maxLength={200} placeholder="What Atlas should do with these" onChange={(e) => setMeaning(e.target.value)} />
          </label>
          <label className="mail-field">
            <span>Preferred agent</span>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Atlas decides</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          <label className="mail-check">
            <input type="checkbox" checked={writeToGmail} onChange={(e) => setWriteToGmail(e.target.checked)} />
            <span>Also label in Gmail</span>
          </label>
          <div className="mail-actions">
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-xs" disabled={!name.trim()} onClick={() => void create()}>Add tag</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DraftCard({ thread, draft, to, run, label }: { thread: MailThread; draft: MailDraft; to: string; run: MailRun; label: string }) {
  // One reply per thread: once any version went out, the others cannot be sent too.
  const otherSent = thread.drafts.some((d) => d.id !== draft.id && d.sentAt);
  const [value, setValue] = useState(draft.body);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const saved = useRef(draft.body);
  const saving = useRef<Promise<boolean>>(Promise.resolve(true));
  const sent = Boolean(draft.sentAt);

  useEffect(() => {
    saved.current = draft.body;
    setValue(draft.body);
  }, [draft.body]);

  const reload = () => useMail.getState().loadThread(thread.id);

  // Saves the edit, if any; later actions wait for it so they always act on the text shown.
  const flush = () => {
    if (value === saved.current) return saving.current;
    const body = value;
    const prev = saved.current;
    saved.current = body;
    saving.current = saving.current.then(() =>
      run(async () => {
        await useMail.getState().editDraft(thread.id, draft.id, body);
        await reload();
      }).then((ok) => {
        if (!ok && saved.current === body) saved.current = prev;
        return ok;
      }),
    );
    return saving.current;
  };

  /** Runs a draft action after any pending edit is saved; a failed save stops it (it would act on old text). */
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    if (!(await flush())) {
      setBusy(false);
      return false;
    }
    const ok = await run(async () => {
      await fn();
      await reload();
    });
    setBusy(false);
    return ok;
  };

  return (
    <article className={`mail-draft${draft.flagged ? " mail-draft-flagged" : ""}`}>
      {draft.flagged && (
        <p className="mail-flag" role="note">Check this: may not be just the reply</p>
      )}
      <div className="hint">
        Drafted {mailDate(draft.createdAt)}
        {draft.gmailDraftId ? " · saved in Gmail drafts" : ""}
        {draft.sentAt ? ` · sent ${mailDate(draft.sentAt)}` : ""}
      </div>
      <textarea
        aria-label={label}
        className="mail-draft-text"
        value={value}
        readOnly={sent}
        rows={8}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void flush()}
      />
      {!sent && (
        <div className="mail-actions">
          <CopyButton className="btn btn-ghost btn-xs" label="Copy reply" getText={() => markdownToPlainText(value)} />
          <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={() => void act(() => useMail.getState().saveDraftToGmail(thread.id, draft.id))}>
            Save to Gmail drafts
          </button>
          <button type="button" className="btn btn-ghost btn-xs" disabled={busy || !to || otherSent} onClick={() => setConfirming(true)}>
            Send…
          </button>
          <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={() => void act(() => useMail.getState().discardDraft(thread.id, draft.id))}>
            Discard
          </button>
        </div>
      )}
      {!sent && otherSent && <p className="hint">Another version of this reply was already sent.</p>}
      {confirming && !otherSent && (
        <div className="mail-confirm" role="alertdialog" aria-label="Send this reply?">
          <strong>Send this reply?</strong>
          <dl className="mail-confirm-meta">
            <dt>To</dt>
            <dd>{to}</dd>
            <dt>Subject</dt>
            <dd>{replySubject(thread.subject)}</dd>
          </dl>
          <div className="mail-text">{value}</div>
          <div className="mail-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void act(() => useMail.getState().sendDraft(thread.id, draft.id)).then((ok) => ok && setConfirming(false))}
            >
              Send email
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/** One thread: its messages as plain text, its tags, and the reply drafts the agents wrote. */
export function MailThreadView({ threadKey, run, onBack }: { threadKey: string; run: MailRun; onBack: () => void }) {
  const thread = useMail((s) => s.threads.find((t) => t.id === threadKey));
  const accounts = useMail((s) => s.status?.accounts);

  useEffect(() => {
    void run(() => useMail.getState().loadThread(threadKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadKey]);

  if (!thread) {
    return (
      <div className="mail-thread">
        <button type="button" className="link" onClick={onBack}>← All threads</button>
        <p className="hint">Loading...</p>
      </div>
    );
  }

  const to = replyTarget(thread, accounts?.find((a) => a.id === thread.accountId)?.email);
  const [latest, ...older] = thread.drafts;

  return (
    <div className="mail-thread">
      <button type="button" className="link" onClick={onBack}>← All threads</button>
      <h3 className="mail-thread-subject">{thread.subject || "(no subject)"}</h3>
      <div className="mail-row-meta">
        {thread.gmailLabels.map((l) => (
          <span key={l} className="chip mail-label">{l}</span>
        ))}
      </div>
      <TagPicker thread={thread} run={run} />

      <div className="mail-thread-cols">
        <section className="mail-messages" aria-label="Messages">
          {thread.messages.map((m) => (
            <article key={m.id} className="mail-message">
              <header className="mail-message-head">
                <strong>{senderName(m.from, m.fromEmail)}</strong>
                <span className="hint">{m.fromEmail}</span>
                <span className="hint">{mailDate(m.date)}</span>
              </header>
              <div className="mail-text">{m.text}</div>
              {m.attachments.length > 0 && (
                <ul className="mail-attachments" aria-label="Attachments">
                  {m.attachments.map((a, i) => (
                    <li key={`${a.name}-${i}`} className="chip">{a.name}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </section>

        <section className="mail-drafts" aria-label="Reply drafts">
          <h3>Reply drafts</h3>
          {!latest ? (
            <p className="hint">No drafts yet. Send this thread to Atlas and a worker will draft a reply. Agents never send email; you do.</p>
          ) : (
            <>
              <DraftCard key={latest.id} thread={thread} draft={latest} to={to} run={run} label="Reply draft" />
              {older.length > 0 && (
                <details className="mail-older">
                  <summary>Previous versions ({older.length})</summary>
                  {older.map((d) => (
                    <DraftCard key={d.id} thread={thread} draft={d} to={to} run={run} label={`Earlier draft from ${mailDate(d.createdAt)}`} />
                  ))}
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
