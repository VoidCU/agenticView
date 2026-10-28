import { useEffect, useMemo, useState } from "react";
import type { MailAmount, MailSender, MailSource } from "@agenticview/shared";
import { useMail } from "../state/mail";
import { mailDate, type MailRun } from "./mailFormat";

type AmountKind = MailAmount["kind"];
const DAY_CHOICES = [7, 30, 90] as const;

function amountText(a: MailAmount): string {
  switch (a.kind) {
    case "latest":
      return `Latest ${a.n}`;
    case "days":
      return `Last ${a.days} days`;
    case "range":
      return `${a.from} to ${a.to}`;
    case "sinceLast":
      return "Since last pull";
  }
}

/** Sources: pick an account's senders and how much of their mail to pull; list and manage saved sources. */
export function MailSources({ run, initialAccountId }: { run: MailRun; initialAccountId?: string }) {
  const accounts = useMail((s) => s.status?.accounts);
  const sources = useMail((s) => s.sources);
  const [accountId, setAccountId] = useState(initialAccountId ?? "");
  const [senders, setSenders] = useState<MailSender[] | undefined>();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [kind, setKind] = useState<AmountKind>("latest");
  const [n, setN] = useState(50);
  const [days, setDays] = useState<number>(30);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [autoCheck, setAutoCheck] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | undefined>();

  // No account asked for: start on the first connected one.
  useEffect(() => {
    if (!accountId && accounts?.[0]) setAccountId(accounts[0].id);
  }, [accountId, accounts]);

  useEffect(() => {
    if (!accountId) return;
    let live = true;
    setSenders(undefined);
    void run(async () => {
      const list = await useMail.getState().senders(accountId);
      if (live) setSenders(list);
    });
    return () => {
      live = false;
    };
    // `run` is recreated each render; reload only when the account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Recent senders (up to 50) plus any picked address that is not among them (an edited source).
  const rows = useMemo(() => {
    const list = (senders ?? []).slice(0, 50);
    const known = new Set(list.map((s) => s.email.toLowerCase()));
    const extra = picked.filter((e) => !known.has(e)).map((email) => ({ email, name: "", count: 0, lastDate: "" }));
    const q = filter.trim().toLowerCase();
    return [...extra, ...list].filter((s) => !q || s.email.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [senders, picked, filter]);

  const amount: MailAmount | undefined =
    kind === "latest" ? (n >= 1 && n <= 500 ? { kind, n } : undefined)
    : kind === "days" ? { kind, days }
    : kind === "range" ? (from && to && from <= to ? { kind, from, to } : undefined)
    : { kind };

  const toggle = (email: string, on: boolean) => {
    const e = email.toLowerCase();
    setPicked((p) => (on ? [...p.filter((x) => x !== e), e] : p.filter((x) => x !== e)));
  };

  const reset = () => {
    setEditingId(undefined);
    setPicked([]);
    setKind("latest");
    setN(50);
    setAutoCheck(false);
  };

  const pullNow = async (id: string) => {
    setBusy(true);
    setDone(undefined);
    const ok = await run(async () => {
      await useMail.getState().pull(id);
      await useMail.getState().loadThreads();
    });
    if (ok) setDone("Pulled. The threads are under Threads.");
    setBusy(false);
  };

  const save = async () => {
    if (!amount || !accountId || picked.length === 0) return;
    setBusy(true);
    setDone(undefined);
    let savedId: string | undefined;
    const ok = await run(async () => {
      const s = await useMail.getState().saveSource({ ...(editingId ? { id: editingId } : {}), accountId, senders: picked, amount, autoCheck });
      savedId = s.id;
    });
    setBusy(false);
    if (ok && savedId) {
      reset();
      await pullNow(savedId);
    }
  };

  const edit = (s: MailSource) => {
    setEditingId(s.id);
    setAccountId(s.accountId);
    setPicked(s.senders.map((e) => e.toLowerCase()));
    setKind(s.amount.kind);
    if (s.amount.kind === "latest") setN(s.amount.n);
    if (s.amount.kind === "days") setDays(s.amount.days);
    if (s.amount.kind === "range") {
      setFrom(s.amount.from);
      setTo(s.amount.to);
    }
    setAutoCheck(s.autoCheck);
  };

  const emailOf = (id: string) => accounts?.find((a) => a.id === id)?.email ?? id;

  if (accounts && accounts.length === 0) {
    return <p className="hint">Connect a Gmail account in Settings → Connections first.</p>;
  }

  return (
    <div className="mail-sources">
      {sources.length > 0 && (
        <section className="mail-section" aria-label="Saved sources">
          <h3>Sources</h3>
          <ul className="mail-source-list">
            {sources.map((s) => (
              <li key={s.id} className="mail-source">
                <div className="mail-source-main">
                  <span className="mail-source-senders">{s.senders.join(", ")}</span>
                  <span className="hint">
                    {emailOf(s.accountId)} · {amountText(s.amount)}
                    {s.autoCheck ? " · checks every 10 minutes" : ""} · {s.lastPulledAt ? `Last pulled ${mailDate(s.lastPulledAt)}` : "Never pulled"}
                  </span>
                </div>
                <div className="mail-actions">
                  <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={() => void pullNow(s.id)}>Pull now</button>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => edit(s)}>Edit</button>
                  <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={() => void run(() => useMail.getState().removeSource(s.id))}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mail-section" aria-label={editingId ? "Edit source" : "New source"}>
        <h3>{editingId ? "Edit source" : "Choose senders"}</h3>
        <label className="mail-field">
          <span>Account</span>
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setPicked([]); }}>
            {!accountId && <option value="">Choose an account</option>}
            {(accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.email}</option>
            ))}
          </select>
        </label>
        <input type="search" className="mail-search" aria-label="Filter senders" placeholder="Filter senders" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {senders === undefined ? (
          accountId && <p className="hint">Loading recent senders...</p>
        ) : rows.length === 0 ? (
          <p className="hint">No senders found.</p>
        ) : (
          <ul className="mail-senders">
            {rows.map((s) => (
              <li key={s.email}>
                <label className="mail-sender">
                  <input type="checkbox" aria-label={s.email} checked={picked.includes(s.email.toLowerCase())} onChange={(e) => toggle(s.email, e.target.checked)} />
                  <span className="mail-sender-name">{s.name || s.email}</span>
                  <span className="mail-sender-email">{s.email}</span>
                  <span className="hint">{s.count ? `${s.count}` : ""}</span>
                  <span className="hint">{mailDate(s.lastDate)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <fieldset className="mail-amount">
          <legend>How much mail</legend>
          <label className="mail-check">
            <input type="radio" name="mail-amount" checked={kind === "latest"} onChange={() => setKind("latest")} />
            <span>Latest</span>
            <input type="number" aria-label="Number of emails" min={1} max={500} value={n} onChange={(e) => setN(Number(e.target.value))} disabled={kind !== "latest"} />
          </label>
          <label className="mail-check">
            <input type="radio" name="mail-amount" checked={kind === "days"} onChange={() => setKind("days")} />
            <span>Last</span>
            <select aria-label="Days" value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={kind !== "days"}>
              {DAY_CHOICES.map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </label>
          <label className="mail-check">
            <input type="radio" name="mail-amount" checked={kind === "range"} onChange={() => setKind("range")} />
            <span>From</span>
            <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={kind !== "range"} />
            <span>to</span>
            <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} disabled={kind !== "range"} />
          </label>
          <label className="mail-check">
            <input type="radio" name="mail-amount" checked={kind === "sinceLast"} onChange={() => setKind("sinceLast")} />
            <span>Since last pull</span>
          </label>
        </fieldset>

        <label className="mail-check">
          <input type="checkbox" checked={autoCheck} onChange={(e) => setAutoCheck(e.target.checked)} />
          <span>Check every 10 minutes while this office is open</span>
        </label>

        <div className="mail-actions">
          {editingId && <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Cancel edit</button>}
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !amount || !accountId || picked.length === 0} onClick={() => void save()}>
            Save &amp; Pull
          </button>
        </div>
        {done && <p className="hint" role="status">{done}</p>}
      </section>
    </div>
  );
}
