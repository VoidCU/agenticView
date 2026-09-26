import type { ClientMessage, ServerMessage } from "@agenticview/shared";
import type { Store } from "../state/store";

const TOKEN_KEY = "agenticview.token";
let token = "";

/** Read the launch token from `#token=…`, remember it, and scrub it from the address bar. */
export function readToken(): string {
  if (token) return token;
  try {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const fromHash = params.get("token");
    if (fromHash) {
      token = fromHash;
      try {
        sessionStorage.setItem(TOKEN_KEY, fromHash);
      } catch {
        /* storage may be unavailable */
      }
      history.replaceState(null, "", window.location.pathname + window.location.search);
      return token;
    }
  } catch {
    /* no window */
  }
  try {
    token = sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    token = "";
  }
  return token;
}

export function getToken(): string {
  return token || readToken();
}

/** fetch() against the server with the launch token attached as a header. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const t = getToken();
  if (t) headers.set("x-agenticview-token", t);
  return fetch(path, { ...init, headers });
}

/** Upload an image via POST /api/upload and return the server-side path. */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name || "image.png");
  const res = await apiFetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as { error?: string }).error ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`Upload failed: ${detail}`);
  }
  const json = (await res.json()) as { path: string };
  return json.path;
}

type StoreApi = { getState(): Store; setState(patch: Partial<Store>): void };

/**
 * run.events arriving within this window are applied as one store update. A busy office streams
 * 100+ events/s; applied one by one each was its own React commit for every subscriber and every
 * drei <Html> root (measured ~490 react-dom commits/s at 160 events/s). 50 ms keeps chat streaming
 * smooth (20 updates/s) while bounding UI work regardless of the event rate.
 */
export const RUN_EVENT_BATCH_MS = 50;

export interface Ingest {
  (msg: ServerMessage): void;
  /** Apply anything queued now. */
  flush(): void;
  /** Drop the pending timer (connection closed). */
  dispose(): void;
}

/**
 * Message intake: run.events are queued and flushed together; any other message first flushes the
 * queue (so ordering is preserved: a task.updated never overtakes the events that preceded it).
 */
export function createIngest(store: Pick<StoreApi, "getState">, windowMs = RUN_EVENT_BATCH_MS): Ingest {
  const queue: ServerMessage[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (queue.length) store.getState().applyMany(queue.splice(0));
  };
  const ingest = ((msg: ServerMessage) => {
    if (msg.type === "run.event") {
      queue.push(msg);
      timer ??= setTimeout(flush, windowMs);
      return;
    }
    flush();
    store.getState().apply(msg);
  }) as Ingest;
  ingest.flush = flush;
  ingest.dispose = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    queue.length = 0;
  };
  return ingest;
}

let activeIngest: Ingest | undefined;

/** Feed a server message through the live connection's intake (test / perf probes). */
export function ingestMessage(store: Pick<StoreApi, "getState">, msg: ServerMessage): void {
  if (activeIngest) activeIngest(msg);
  else store.getState().apply(msg);
}

export interface Connection {
  send(m: ClientMessage): void;
  close(): void;
}

/**
 * Open the WebSocket, feed every message to `store.apply`, reconnect with backoff
 * (0.5 s -> 5 s) and re-request a snapshot after each reopen. Messages sent while
 * offline are queued and flushed on connect.
 */
export function connect(store: StoreApi, opts: { url?: string } = {}): Connection {
  const t = readToken();
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const url = opts.url ?? `${proto}://${window.location.host}/ws?token=${encodeURIComponent(t)}`;
  let ws: WebSocket | undefined;
  let closed = false;
  let delay = 500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queue: ClientMessage[] = [];
  let everOpened = false;
  const ingest = createIngest(store);
  activeIngest = ingest;

  const send = (m: ClientMessage) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    else queue.push(m);
  };

  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      delay = 500;
      store.getState().setConnected(true);
      if (everOpened) send({ type: "snapshot.request" });
      everOpened = true;
      while (queue.length) ws!.send(JSON.stringify(queue.shift()));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      ingest(msg);
    };
    ws.onclose = () => {
      ingest.flush();
      store.getState().setConnected(false);
      ws = undefined;
      if (closed) return;
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, 5000);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  };

  store.setState({ send });
  open();

  return {
    send,
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      ingest.dispose();
      if (activeIngest === ingest) activeIngest = undefined;
      ws?.close();
    },
  };
}
