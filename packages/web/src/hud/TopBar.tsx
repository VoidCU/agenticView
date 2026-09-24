import { useStore } from "../state/store";
import { GearIcon, PlusIcon, ProviderChip } from "./ui";

function Mark() {
  return (
    <svg className="mark" width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="17" r="12" fill="#5b8cff" />
      <circle cx="11.5" cy="15" r="3" fill="#fff" />
      <circle cx="20.5" cy="15" r="3" fill="#fff" />
      <circle cx="12" cy="15.5" r="1.3" fill="#11131c" />
      <circle cx="21" cy="15.5" r="1.3" fill="#11131c" />
      <rect x="15.2" y="1" width="1.6" height="5" rx="0.8" fill="#c9ced9" />
      <circle cx="16" cy="1.8" r="1.8" fill="#ffd166" />
    </svg>
  );
}

interface Props {
  onSettings: () => void;
  onCreate: () => void;
}

export function TopBar({ onSettings, onCreate }: Props) {
  const world = useStore((s) => s.world);
  const providers = useStore((s) => s.providers);
  const connected = useStore((s) => s.connected);
  const hub = world?.kind === "hub";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Mark />
        <div className="world">
          <span className="world-name">{world?.name ?? "AgenticView"}</span>
          <span className="world-kind" title={hub ? "Global agents and every project you have opened" : world?.projectPath ?? ""}>
            {hub ? "Hub" : "Project"}
          </span>
        </div>
      </div>
      <div className="topbar-mid" aria-label="Providers">
        {providers.map((p) => (
          <ProviderChip key={p.provider} status={p} />
        ))}
      </div>
      <div className="topbar-right">
        <span className="switch" role="group" aria-label="World">
          <span className={`switch-item ${!hub ? "switch-on" : ""}`} title={hub ? "Open a project from the Projects panel" : undefined}>
            Project
          </span>
          <span className={`switch-item ${hub ? "switch-on" : ""}`} title={hub ? undefined : "Run /agenticview-hub in Claude Code to open the hub"}>
            Hub
          </span>
        </span>
        <button type="button" className="btn btn-primary btn-sm" onClick={onCreate}>
          <PlusIcon />
          New agent
        </button>
        <button type="button" className="icon-btn" onClick={onSettings} aria-label="Settings" title="Settings">
          <GearIcon />
        </button>
        <span className={`conn ${connected ? "conn-on" : "conn-off"}`} title={connected ? "Connected" : "Reconnecting"} role="status" aria-label={connected ? "Connected" : "Reconnecting"} />
      </div>
    </header>
  );
}
