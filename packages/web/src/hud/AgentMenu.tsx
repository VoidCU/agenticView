import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { planOffice, type Agent } from "@agenticview/shared";
import { useStore } from "../state/store";
import { CreateAgentModal } from "./CreateAgentModal";
import { MoreIcon } from "./ui";
import { RPS_BUSY_LINE, agentOnTask } from "../state/rps";

/** Actions for the agent shown in the chat header: edit, play RPS (anywhere, not just the lounge), copy to project, delete. */
export function AgentMenu({ agent }: { agent: Agent }) {
  const send = useStore((s) => s.send);
  const world = useStore((s) => s.world);
  const agents = useStore((s) => s.agents);
  const layout = useStore((s) => s.layout);
  const spaceNames = useStore((s) => s.spaceNames);
  // Busy on a task: the challenge is declined, so the item shows disabled with the reason.
  const busy = useStore((s) => agentOnTask(s.tasks, agent.id));
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
  const roomPlan = useMemo(() => planOffice(Object.values(agents), layout, spaceNames), [agents, layout, spaceNames]);
  const occupiedSeats = new Set(Object.entries(roomPlan.placements).filter(([id]) => id !== agent.id).map(([, p]) => `${p.space}#${p.seat}`));
  const moveRooms = agent.role === "worker" ? roomPlan.spaces.filter((s) => s.seats > 0) : [];

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
          <button type="button" role="menuitem" disabled={busy} aria-disabled={busy} title={busy ? `${agent.name} is busy on a task: "${RPS_BUSY_LINE}"` : undefined} onClick={() => (setOpen(false), window.dispatchEvent(new CustomEvent("agenticview:play-rps", { detail: { agentId: agent.id } })))}>
            {busy ? "Play rock-paper-scissors (busy)" : "Play rock-paper-scissors"}
          </button>
          {canCopy && (
            <button type="button" role="menuitem" onClick={() => (setOpen(false), send({ type: "agent.copyToProject", id: agent.id }))}>
              Copy to this project
            </button>
          )}
          {agent.role === "worker" && <div className="menu-room-move" role="none">
            <label htmlFor={`move-room-${agent.id}`}>Move to room</label>
            <select id={`move-room-${agent.id}`} aria-label={`Move ${agent.name} to room`} value={roomPlan.placements[agent.id]?.space ?? ""}
              onChange={(event) => {
                const space = roomPlan.spaces.find((s) => s.id === event.target.value);
                if (!space) return;
                const seat = Array.from({ length: space.seats }, (_, i) => i).find((i) => !occupiedSeats.has(`${space.id}#${i}`));
                if (seat === undefined) return;
                send({ type: "agent.update", id: agent.id, patch: { placement: { space: space.id, seat } } });
                setOpen(false);
              }}>
              {moveRooms.map((space) => <option key={space.id} value={space.id} disabled={Array.from({ length: space.seats }, (_, i) => i).every((i) => occupiedSeats.has(`${space.id}#${i}`)) && roomPlan.placements[agent.id]?.space !== space.id}>{space.name}</option>)}
            </select>
          </div>}
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
