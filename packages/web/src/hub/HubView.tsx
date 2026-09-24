import { useEffect, useState, type FormEvent } from "react";
import { useStore } from "../state/store";
import { timeAgo } from "../hud/ui";

/** Hub: known projects with Open buttons, plus a field to open any path. `opened` urls go to a new tab. */
export function ProjectsPanel() {
  const projects = useStore((s) => s.world?.knownProjects ?? []);
  const send = useStore((s) => s.send);
  const opened = useStore((s) => s.opened);
  const [path, setPath] = useState("");
  const [pending, setPending] = useState<string | undefined>();

  useEffect(() => {
    if (!opened) return;
    window.open(opened, "_blank", "noopener,noreferrer");
    setPending(undefined);
    useStore.setState({ opened: undefined });
  }, [opened]);

  const open = (p: string) => {
    setPending(p);
    send({ type: "project.open", path: p });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = path.trim();
    if (p) open(p);
  };

  const sorted = [...projects].sort((a, b) => b.lastOpened.localeCompare(a.lastOpened));
  return (
    <section className="panel panel-projects" aria-label="Projects">
      <div className="panel-head">
        <h2>Projects</h2>
        <span className="panel-count">{sorted.length}</span>
      </div>
      <div className="panel-body">
        {sorted.length === 0 && <p className="empty">No projects opened yet. Run /agenticview inside a project, or type a folder path below.</p>}
        <ul className="project-list">
          {sorted.map((p) => (
            <li key={p.path} className="project">
              <div className="project-main">
                <div className="project-name">{p.name}</div>
                <div className="project-path" title={p.path}>
                  {p.path}
                </div>
                <div className="project-when">opened {timeAgo(p.lastOpened)}</div>
              </div>
              <button type="button" className="btn btn-primary btn-xs" onClick={() => open(p.path)} disabled={pending === p.path}>
                {pending === p.path ? "Opening" : "Open"}
              </button>
            </li>
          ))}
        </ul>
        <form className="project-open" onSubmit={submit}>
          <input value={path} onChange={(e) => setPath(e.target.value)} aria-label="Project folder" placeholder="C:\path\to\project" />
          <button type="submit" className="btn btn-ghost btn-xs" disabled={!path.trim()}>
            Open folder
          </button>
        </form>
      </div>
    </section>
  );
}
