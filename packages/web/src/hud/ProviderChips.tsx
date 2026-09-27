import { useEffect, useId, useRef, useState } from "react";
import { catalogueFor, isCustomProvider, type ProviderStatus } from "@agenticview/shared";
import { useStore } from "../state/store";
import { ProviderChip, providerLabel } from "./ui";
import { splitHeaderChips } from "./headerChips";

/** "Opus, Sonnet, Haiku +1" for the dropdown's model line. */
function modelsLine(p: ProviderStatus): string {
  const models = catalogueFor(p.provider).models;
  if (models.length === 0) return isCustomProvider(p.provider) ? "any model id" : "provider default";
  const names = models.slice(0, 3).map((m) => m.label.replace(/\s*\(.*\)$/, ""));
  return models.length > 3 ? `${names.join(", ")} +${models.length - 3}` : names.join(", ");
}

function CompactChip({ p }: { p: ProviderStatus }) {
  return (
    <span className="provider-compact" title={`${providerLabel(p.provider)}: ${p.ok ? "Ready" : p.reason ?? "Unavailable"}`}>
      <ProviderChip status={p} compact />
      {p.limit?.limited && <span className="provider-limited">limited</span>}
    </span>
  );
}

/**
 * Header provider chips in the user's provider order. Past four, the rest collapse into a "+N more"
 * chip whose dropdown (hover or click; Escape closes) lists every provider with status, limits and models.
 */
export function ProviderChips({ onSettings }: { onSettings?: () => void }) {
  const providers = useStore((s) => s.providers);
  const order = useStore((s) => s.providerConfig?.providerOrder);
  const { all, visible, hidden } = splitHeaderChips(providers, order);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const hoverOpen = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 250);
  };
  const limitedHidden = hidden.filter((p) => p.limit?.limited).length;

  return (
    <div className="topbar-mid" aria-label="Providers" role="group">
      {visible.map((p) => (
        <CompactChip key={p.provider} p={p} />
      ))}
      {hidden.length > 0 && (
        <div
          className="provider-more"
          ref={wrap}
          onMouseEnter={hoverOpen}
          onMouseLeave={hoverClose}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.stopPropagation();
              setOpen(false);
              button.current?.focus();
            }
          }}
        >
          <button
            ref={button}
            type="button"
            className={`chip provider-more-button${limitedHidden ? " provider-more-limited" : ""}`}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${hidden.length} more providers${limitedHidden ? `, ${limitedHidden} limited` : ""}`}
            data-testid="provider-more"
            onClick={() => setOpen((o) => !o)}
          >
            +{hidden.length} more
          </button>
          {open && (
            <div className="provider-more-panel" id={panelId} role="region" aria-label="All providers" data-testid="provider-more-panel">
              <ul className="provider-more-list">
                {all.map((p) => (
                  <li key={p.provider} className="provider-more-item">
                    <span className={`chip-dot provider-more-dot ${p.ok ? "dot-ok" : "dot-off"}`} aria-hidden="true" />
                    <span className="provider-more-text">
                      <span className="provider-more-name">
                        {providerLabel(p.provider)}
                        {isCustomProvider(p.provider) && <span className="provider-more-tag">custom</span>}
                        {p.limit?.limited && <span className="provider-limited">limited</span>}
                      </span>
                      <span className="provider-more-sub">{p.ok ? modelsLine(p) : p.reason ?? "Unavailable"}</span>
                    </span>
                    <span className="sr-only">{p.ok ? "ready" : "unavailable"}</span>
                  </li>
                ))}
              </ul>
              {onSettings && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs provider-more-settings"
                  onClick={() => {
                    setOpen(false);
                    onSettings();
                  }}
                >
                  Provider settings…
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
