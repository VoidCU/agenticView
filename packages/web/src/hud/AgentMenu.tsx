import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Agent } from "@agenticview/shared";
import { useStore } from "../state/store";
import { CreateAgentModal } from "./CreateAgentModal";
import { MoreIcon } from "./ui";

/** Actions for the agent shown in the chat header: edit, copy to project, delete. */
export function AgentMenu({ agent }: { agent: Agent }) {
  const send = useStore((s) => s.send);
  const world = useStore((s) => s.world);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const canCopy = agent.scope === "global" && agent.role === "worker" && world?.kind === "project";
  const canDelete = agent.role !== "manager";

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="icon-btn" aria-label={`Actions for ${agent.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreIcon />
      </button>
      {open &&
        pos &&
        createPortal(
        // Fixed and portalled so the panel's overflow clipping cannot cut the menu off.
        <div className="menu menu-fixed" role="menu" ref={menuRef} style={{ top: pos.top, right: pos.right }}>
          <button type="button" role="menuitem" onClick={() => (setOpen(false), setEditing(true))}>
            Edit {agent.name}
          </button>
          {canCopy && (
            <button type="button" role="menuitem" onClick={() => (setOpen(false), send({ type: "agent.copyToProject", id: agent.id }))}>
              Copy to this project
            </button>
          )}
          {canDelete && !confirming && (
            <button type="button" role="menuitem" className="menu-danger" onClick={() => setConfirming(true)}>
              Delete {agent.name}
            </button>
          )}
          {canDelete && confirming && (
            <div className="menu-confirm">
              <span>Delete {agent.name}? Their history goes too.</span>
              <button type="button" className="btn btn-danger btn-xs" onClick={() => (setOpen(false), setConfirming(false), send({ type: "agent.delete", id: agent.id }))}>
                Delete
              </button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
      {editing && <CreateAgentModal edit={agent} onClose={() => setEditing(false)} />}
    </div>
  );
}
