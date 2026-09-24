import { useStore, type PendingPermission } from "../state/store";
import { prettyInput } from "./ui";

/** One pending permission with Allow / Deny. Reused inside the robot's bubble. */
export function PermissionActions({ permission, compact = false }: { permission: PendingPermission; compact?: boolean }) {
  const send = useStore((s) => s.send);
  const respond = (allow: boolean) => send({ type: "permission.respond", id: permission.id, allow });
  return (
    <div className={`perm-actions ${compact ? "perm-actions-compact" : ""}`}>
      <button type="button" className="btn btn-primary btn-xs" onClick={() => respond(true)} aria-label={`Allow ${permission.tool}`}>
        Allow
      </button>
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => respond(false)} aria-label={`Deny ${permission.tool}`}>
        Deny
      </button>
    </div>
  );
}

export function PermissionToast() {
  const permissions = useStore((s) => s.permissions);
  const agents = useStore((s) => s.agents);
  const select = useStore((s) => s.select);
  if (permissions.length === 0) return null;
  return (
    <div className="toasts toasts-perm" aria-live="assertive">
      {permissions.map((p) => {
        const agent = agents[p.agentId];
        const detail = prettyInput(p.tool, p.input);
        return (
          <div key={p.id} className="toast toast-perm" role="group" aria-label={`Permission request from ${agent?.name ?? p.agentId}`}>
            <div className="toast-body">
              <div className="toast-title">
                <button type="button" className="link" onClick={() => select(p.agentId)}>
                  {agent?.name ?? p.agentId}
                </button>
                <span> wants to run </span>
                <code>{p.tool}</code>
              </div>
              {detail && <pre className="toast-detail">{detail}</pre>}
            </div>
            <PermissionActions permission={p} />
          </div>
        );
      })}
    </div>
  );
}
