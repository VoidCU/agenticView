import { useState, type FormEvent } from "react";
import { selectManager, useStore } from "../state/store";
import { SendIcon } from "./ui";

/** The bar at the bottom talks to the manager. In the hub it also picks which project the request is for. */
export function CommandBar() {
  const manager = useStore(selectManager);
  const world = useStore((s) => s.world);
  const sendChat = useStore((s) => s.sendChat);
  const select = useStore((s) => s.select);
  const connected = useStore((s) => s.connected);
  const [text, setText] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const hub = world?.kind === "hub";
  const projects = world?.knownProjects ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !manager) return;
    sendChat(manager.id, t, [], hub && projectPath ? projectPath : undefined);
    select(manager.id);
    setText("");
  };

  const name = manager?.name ?? "the manager";
  return (
    <form className="commandbar" onSubmit={submit}>
      {hub && (
        <select value={projectPath} onChange={(e) => setProjectPath(e.target.value)} aria-label="Project for this request" className="commandbar-project">
          <option value="">Any project</option>
          {projects.map((p) => (
            <option key={p.path} value={p.path}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Tell ${name} what to build…`}
        aria-label={`Tell ${name} what to build`}
        disabled={!manager}
        autoComplete="off"
      />
      <button type="submit" className="btn btn-primary" disabled={!text.trim() || !manager} title={connected ? "Send" : "Queued until reconnected"}>
        <SendIcon />
        <span>Send</span>
      </button>
    </form>
  );
}
