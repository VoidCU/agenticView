import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PROVIDER_LABELS, type Provider, type ProviderStatus } from "@agenticview/shared";

export const PROVIDER_LABEL: Record<string, string> = PROVIDER_LABELS;

/** The provider an agent without its own provider runs on: the explicit default, else what Automatic resolved to. */
export function defaultProviderOf(explicit: Provider | null | undefined, auto: Provider | null | undefined): Provider {
  return explicit ?? auto ?? "claude";
}

/** "Automatic (Codex)", or "Automatic (none available)". */
export function automaticLabel(auto: Provider | null | undefined): string {
  return `Automatic (${auto ? providerLabel(auto) : "none available"})`;
}

export function providerLabel(p: string | null | undefined, fallback = "Default"): string {
  return p ? (PROVIDER_LABEL[p] ?? p) : fallback;
}

/** A small provider pill with an availability dot. Unavailable providers are greyed with the reason as the title. */
export function ProviderChip({ status, compact = false }: { status: ProviderStatus; compact?: boolean }) {
  const title = status.ok ? `${providerLabel(status.provider)}${status.version ? ` (${status.version})` : ""} is ready` : status.reason ?? "Unavailable";
  return (
    <span className={`chip ${status.ok ? "chip-ok" : "chip-off"}`} title={title} data-provider={status.provider}>
      <span className="chip-dot" aria-hidden="true" />
      {compact ? providerLabel(status.provider) : `${providerLabel(status.provider)}${status.ok && status.version ? ` · ${status.version}` : ""}`}
      {!status.ok && <span className="sr-only"> unavailable: {status.reason}</span>}
    </span>
  );
}

/** Modal shell: focus trap-lite (focus first field, Escape closes, click on the backdrop closes). */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portal to <body>: panels use backdrop-filter, which would otherwise trap a fixed-position modal inside them.
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 16l-5-5-8 8" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

/** Human summary of a tool call's input: the command for shells, the file for edits, else a short JSON. */
export function prettyInput(tool: string, input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    for (const key of ["command", "cmd", "file_path", "filePath", "path", "url", "pattern", "query"]) {
      const v = o[key];
      if (typeof v === "string" && v) return v;
    }
    try {
      const s = JSON.stringify(input);
      return s.length > 160 ? `${s.slice(0, 157)}...` : s;
    } catch {
      return "";
    }
  }
  if (typeof input === "string") return input;
  return input == null ? "" : String(input);
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function timeAgo(iso: string | number, now = Date.now()): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function xpProgress(xp: number, level: number): { pct: number; next: number } {
  const floor = 25 * (level - 1) ** 2;
  const next = 25 * level ** 2;
  const pct = next === floor ? 0 : Math.min(100, Math.round(((xp - floor) / (next - floor)) * 100));
  return { pct, next };
}
