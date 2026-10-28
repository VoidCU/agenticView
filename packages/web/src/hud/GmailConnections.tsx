import { useEffect, useState, type FormEvent } from "react";
import { useMail } from "../state/mail";

const ACK_KEY = "agenticview.mail.privacyAck";
export const PRIVACY_NOTICE = "Emails you send to Atlas are shared with the AI provider your agents use.";

function readAck(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAck(): void {
  try {
    localStorage.setItem(ACK_KEY, "1");
  } catch {
    /* storage unavailable: the notice shows again next time */
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Settings → Connections: set up the Google OAuth client and connect or remove Gmail accounts. */
export function GmailConnections() {
  const status = useMail((s) => s.status);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [acked, setAcked] = useState(readAck);
  const [confirmReset, setConfirmReset] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void useMail.getState().refresh("accounts");
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  function saveClient(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await useMail.getState().setClient({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
      setClientSecret("");
    });
  }

  function connect() {
    if (!acked) {
      if (!ticked) return;
      writeAck();
      setAcked(true);
    }
    void run(() => useMail.getState().connect());
  }

  function chooseSenders(accountId: string) {
    window.dispatchEvent(new CustomEvent("agenticview:open-mail", { detail: { accountId, view: "sources" } }));
  }

  return (
    <section className="settings-section gmail-connections" aria-label="Gmail">
      <header>
        <h3>Gmail</h3>
        <p className="section-desc">Bring email threads into the office so your agents can draft replies. Nothing is sent without your confirmation.</p>
      </header>

      {!status ? (
        <p className="hint">Loading...</p>
      ) : !status.clientConfigured ? (
        <form className="gmail-setup" onSubmit={saveClient}>
          <ol className="gmail-steps">
            <li>Create a Google Cloud project.</li>
            <li>Enable the Gmail API.</li>
            <li>
              Set up the OAuth consent screen. Choose <strong>Internal</strong> if you use Google Workspace, otherwise publish it &quot;In production&quot;. Testing mode signs you out every 7 days.
            </li>
            <li>
              Create an OAuth client of type <strong>Desktop app</strong>.
            </li>
            <li>Paste the Client ID and Client secret.</li>
          </ol>
          <label className="gmail-field">
            <span>Client ID</span>
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="gmail-field">
            <span>Client secret</span>
            <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy || !clientId.trim() || !clientSecret.trim()}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <div className="gmail-accounts">
          {status.accounts.length === 0 && <p className="hint">No Gmail account connected yet.</p>}
          <ul className="gmail-account-list">
            {status.accounts.map((a) => (
              <li key={a.id} className="gmail-account">
                <div className="gmail-account-main">
                  <span className="gmail-account-email">{a.email}</span>
                  <span className="hint">Connected {formatDate(a.connectedAt)}</span>
                  {a.needsReconnect && <span className="chip gmail-reconnect">Reconnect</span>}
                </div>
                <div className="gmail-account-actions">
                  {a.needsReconnect && (
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={connect}>
                      Reconnect account
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost" onClick={() => chooseSenders(a.id)}>
                    Choose senders
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={busy} aria-label={`Disconnect ${a.email}`} onClick={() => void run(() => useMail.getState().disconnect(a.id))}>
                    Disconnect
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!acked && (
            <div className="gmail-privacy" role="note">
              <p>{PRIVACY_NOTICE}</p>
              <label className="gmail-ack">
                <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
                <span>I understand</span>
              </label>
            </div>
          )}
          <div>
            <button type="button" className="btn btn-primary" disabled={busy || (!acked && !ticked)} onClick={connect}>
              Connect a Gmail account
            </button>
          </div>
          {confirmReset ? (
            <div className="gmail-privacy" role="alertdialog" aria-label="Remove Google client">
              <p>Remove the saved Google client? Connected accounts will stop syncing until you add one again.</p>
              <div className="gmail-account-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    await useMail.getState().setClient(null);
                    setConfirmReset(false);
                  })}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button type="button" className="btn btn-ghost gmail-reset" disabled={busy} onClick={() => setConfirmReset(true)}>
                Change Google client
              </button>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="hint hint-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
