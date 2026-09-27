import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { DEFAULT_IDLE_BEHAVIOUR, catalogueFor, orderedProviders, type Provider } from "@agenticview/shared";
import { useStore } from "../state/store";
import { UsagePanel } from "./UsagePanel";
import { ProvidersPanel } from "./ProvidersPanel";
import { Modal, ProviderOptions, automaticLabel, providerLabel } from "./ui";
import { getNotificationPref, requestNotificationPermission, setNotificationPref } from "./useNotifications";

export type SettingsTab = "general" | "providers" | "office" | "usage";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
  { id: "office", label: "Office life" },
  { id: "usage", label: "Usage" },
];

/** A labelled setting: label + control on the left/right, description underneath. One layout for every field. */
function Row({ label, htmlFor, desc, children, toggle = false }: { label: string; htmlFor: string; desc?: string; children: React.ReactNode; toggle?: boolean }) {
  return (
    <div className={`setting-row${toggle ? " setting-row-toggle" : ""}`}>
      <div className="setting-label">
        <label htmlFor={htmlFor}>{label}</label>
        {desc && (
          <p className="setting-desc" id={`${htmlFor}-desc`}>
            {desc}
          </p>
        )}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function SettingsModal({ onClose, initialTab }: { onClose: () => void; initialTab?: SettingsTab }) {
  const settings = useStore((s) => s.settings);
  const providers = useStore((s) => s.providers);
  const autoProvider = useStore((s) => s.autoProvider);
  const providerConfig = useStore((s) => s.providerConfig);
  const send = useStore((s) => s.send);
  const world = useStore((s) => s.world);
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? "general");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // General
  const [provider, setProvider] = useState<Provider | "">(settings?.defaultProvider ?? "");
  const [model, setModel] = useState(settings?.defaultModel ?? "");
  const [max, setMax] = useState(settings?.maxConcurrentRuns ?? 3);
  const [limitPolicy, setLimitPolicy] = useState<"ask" | "auto" | "manager">(settings?.limitPolicy ?? "ask");
  const [preferCheapModels, setPreferCheapModels] = useState(settings?.preferCheapModels ?? false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => getNotificationPref());

  // Providers: one order (Automatic, failover, header chips); failover = the ticked subset, in that order.
  const initialOrder = useMemo(
    () => orderedProviders(providerConfig?.providerOrder ?? providers.map((p) => p.provider), [...new Set([...providers.map((p) => p.provider), ...(providerConfig?.providerOrder ?? [])])]),
    // Captured once when the dialog opens; later pushes must not reset the user's unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [order, setOrder] = useState<Provider[]>(initialOrder);
  const [failover, setFailover] = useState<Set<string>>(() => new Set(settings?.failoverOrder ?? []));
  // Providers added while the dialog is open (a new custom one) join the end of the list.
  const fullOrder = useMemo(() => [...order, ...providers.map((p) => p.provider).filter((p) => !order.includes(p))], [order, providers]);

  // Office life
  const [loungeBreaks, setLoungeBreaks] = useState(settings?.loungeBreaks ?? true);
  const [idleLoungeMinutes, setIdleLoungeMinutes] = useState(settings?.idleLoungeMinutes ?? 3);
  const idle = settings?.idleBehaviour ?? DEFAULT_IDLE_BEHAVIOUR;
  const [deskPct, setDeskPct] = useState(Math.round(idle.stayChance * 100));
  const [visitPct, setVisitPct] = useState(Math.round(idle.visitChance * 100));
  const [loungePct, setLoungePct] = useState(Math.round(idle.loungeChance * 100));
  const pctSum = deskPct + visitPct + loungePct;
  const pctValid = pctSum === 100 && [deskPct, visitPct, loungePct].every((p) => Number.isInteger(p) && p >= 0 && p <= 100);

  const resolvedDefault = provider || autoProvider;
  const modelSuggestions = resolvedDefault ? catalogueFor(resolvedDefault).models : [];

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    if (!pctValid) {
      setTab("office");
      return;
    }
    send({ type: "provider.order", order: fullOrder });
    send({
      type: "settings.update",
      settings: {
        defaultProvider: provider || null,
        defaultModel: model.trim() || null,
        maxConcurrentRuns: Math.min(10, Math.max(1, Math.round(max))),
        limitPolicy,
        failoverOrder: fullOrder.filter((p) => failover.has(p)),
        loungeBreaks,
        idleLoungeMinutes: Math.min(60, Math.max(0, Math.round(idleLoungeMinutes))),
        preferCheapModels,
        idleBehaviour: { ...idle, stayChance: deskPct / 100, visitChance: visitPct / 100, loungeChance: loungePct / 100 },
      },
    });
    onClose();
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    const id = TABS[next]!.id;
    setTab(id);
    tabRefs.current[id]?.focus();
  };

  const panel = (id: SettingsTab) => ({ role: "tabpanel", id: `settings-panel-${id}`, "aria-labelledby": `settings-tab-${id}`, hidden: tab !== id, className: "settings-tabpanel" }) as const;

  return (
    <Modal title={world?.kind === "hub" ? "Hub settings" : "Project settings"} onClose={onClose} wide className="settings-modal">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`settings-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`settings-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`tab ${tab === t.id ? "tab-on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "office" && !pctValid && <span className="tab-alert" aria-label="needs attention">!</span>}
          </button>
        ))}
      </div>

      <div className="settings-body">
        <form {...panel("general")} onSubmit={save}>
          <section className="settings-section">
            <header>
              <h3>Agents</h3>
              <p className="section-desc">What new and unassigned agents run on, and how much runs at once in this {world?.kind === "hub" ? "hub" : "project"}.</p>
            </header>
            <Row label="Default provider" htmlFor="set-provider" desc={`Automatic picks the first available provider in your provider order (now: ${autoProvider ? providerLabel(autoProvider) : "none available"}).`}>
              <select id="set-provider" value={provider} onChange={(e) => setProvider(e.target.value as Provider | "")} aria-describedby="set-provider-desc">
                <option value="">{automaticLabel(autoProvider)}</option>
                <ProviderOptions providers={providers} />
              </select>
            </Row>
            <Row label="Default model" htmlFor="set-model" desc="Empty uses the provider's own default.">
              <input id="set-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="provider default" autoComplete="off" list="set-model-list" aria-describedby="set-model-desc" />
              <datalist id="set-model-list">
                {modelSuggestions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </datalist>
            </Row>
            <Row label="Workers running at once" htmlFor="set-max" desc="1 to 10. Extra tasks wait in the queue.">
              <input id="set-max" type="number" min={1} max={10} value={max} onChange={(e) => setMax(Number(e.target.value))} aria-describedby="set-max-desc" />
            </Row>
            <Row label="Prefer cheap models" htmlFor="set-cheap" desc="When the Manager creates an agent without naming a model, it picks the cheapest available one." toggle>
              <input id="set-cheap" type="checkbox" checked={preferCheapModels} onChange={(e) => setPreferCheapModels(e.target.checked)} aria-label="Prefer cheap models" />
            </Row>
          </section>
          <section className="settings-section">
            <header>
              <h3>Limits and alerts</h3>
            </header>
            <Row label="When an agent hits a limit" htmlFor="set-limit" desc="Failover follows the ticked providers in Providers > Provider order.">
              <select id="set-limit" value={limitPolicy} onChange={(e) => setLimitPolicy(e.target.value as "ask" | "auto" | "manager")} aria-label="Limit policy" aria-describedby="set-limit-desc">
                <option value="ask">Ask me</option>
                <option value="auto">Switch automatically</option>
                <option value="manager">Switch automatically, Manager reviews</option>
              </select>
            </Row>
            <Row label="Desktop notifications" htmlFor="set-notify" desc="Questions, permission prompts and limits while the tab is in the background (this browser only)." toggle>
              <input
                id="set-notify"
                type="checkbox"
                checked={notificationsEnabled}
                onChange={async (e) => {
                  if (e.target.checked) setNotificationsEnabled(await requestNotificationPermission());
                  else {
                    setNotificationPref(false);
                    setNotificationsEnabled(false);
                  }
                }}
                aria-label="Desktop notifications"
              />
            </Row>
          </section>
          <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        </form>

        <div {...panel("providers")}>
          <ProvidersPanel order={fullOrder} setOrder={setOrder} failover={failover} setFailover={setFailover} />
        </div>

        <form {...panel("office")} onSubmit={save}>
          <section className="settings-section">
            <header>
              <h3>Breaks</h3>
            </header>
            <Row label="Lounge breaks" htmlFor="set-breaks" desc="The Manager may suggest a lounge break when the project is quiet." toggle>
              <input id="set-breaks" type="checkbox" checked={loungeBreaks} onChange={(e) => setLoungeBreaks(e.target.checked)} aria-label="Lounge breaks" />
            </Row>
          </section>
          <fieldset className="settings-section field-set office-life" aria-describedby="office-life-hint">
            <legend>Office life</legend>
            <p className="section-desc" id="office-life-hint">
              Idle workers roll every few minutes and pick one of these. At most half the lounge spots are used by idle workers; when the lounge is that full, a roll stays at the desk.
            </p>
            <Row label="Idle minutes before workers wander" htmlFor="set-idle" desc="0 turns idle wandering off.">
              <input id="set-idle" type="number" min={0} max={60} value={idleLoungeMinutes} onChange={(e) => setIdleLoungeMinutes(Number(e.target.value))} aria-label="Idle lounge minutes" />
            </Row>
            {(
              [
                ["Stay at desk", deskPct, setDeskPct, "desk"],
                ["Visit a colleague or board", visitPct, setVisitPct, "visit"],
                ["Go to the lounge", loungePct, setLoungePct, "lounge"],
              ] as const
            ).map(([label, value, set, key]) => (
              <div key={key} className="setting-row pct-row">
                <div className="setting-label">
                  <label htmlFor={`set-pct-${key}`}>{label}</label>
                </div>
                <div className="setting-control pct-control">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={value}
                    onChange={(e) => set(Number(e.target.value))}
                    aria-hidden="true"
                    tabIndex={-1}
                    className="pct-slider"
                  />
                  <input
                    id={`set-pct-${key}`}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={value}
                    onChange={(e) => set(Number(e.target.value))}
                    aria-label={`${label} percent`}
                    aria-invalid={!pctValid}
                    className="pct-input"
                  />
                  <span className="pct-unit" aria-hidden="true">
                    %
                  </span>
                </div>
              </div>
            ))}
            <p className={`pct-sum ${pctValid ? "" : "pct-sum-bad"}`} aria-live="polite">
              Total {pctSum}%
            </p>
            {!pctValid && (
              <p className="hint hint-error" role="alert">
                The three chances must be whole numbers that add up to 100 (now {pctSum}).
              </p>
            )}
          </fieldset>
          <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        </form>

        <div {...panel("usage")}>{tab === "usage" && <UsagePanel />}</div>
      </div>

      {tab !== "usage" && (
        <div className="form-actions settings-actions">
          <span className="settings-actions-note">{tab === "providers" ? "Order and failover are saved with the settings; keys and custom providers save on their own." : ""}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!pctValid} onClick={() => save()}>
            Save settings
          </button>
        </div>
      )}
    </Modal>
  );
}
