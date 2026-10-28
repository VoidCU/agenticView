import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MailThread } from "@agenticview/shared";
import { App } from "../src/App";
import { MailModal } from "../src/hud/MailModal";
import { useMail } from "../src/state/mail";
import { useStore } from "../src/state/store";
import { manager, snapshot, worker } from "./fixtures";

const ACCOUNT = { id: "a1", email: "me@x.com", connectedAt: "2026-10-01T00:00:00Z" };

function thread(over: Partial<MailThread> = {}): MailThread {
  return {
    id: "a1_t1",
    accountId: "a1",
    gmailThreadId: "t1",
    subject: "Invoice question",
    messages: [
      {
        id: "m1",
        from: "Alice <alice@x.com>",
        fromEmail: "alice@x.com",
        to: "me@x.com",
        date: "2026-10-20T10:00:00Z",
        text: "Hello,\nwhere is my invoice?",
        attachments: [{ name: "scan.pdf", size: 1200 }],
      },
    ],
    gmailLabels: ["INBOX"],
    tags: [],
    sentToAtlas: [],
    drafts: [],
    updatedAt: "2026-10-20T10:00:00Z",
    ...over,
  };
}

type Handler = (url: string, init: RequestInit | undefined) => Response | undefined;

function mockFetch(opts: { threads?: MailThread[]; senders?: unknown; handler?: Handler } = {}) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
    const custom = opts.handler?.(u, init);
    if (custom) return custom;
    if (u === "/api/mail/status") return json({ clientConfigured: true, accounts: [ACCOUNT] });
    if (u === "/api/mail/sources" && (init?.method ?? "GET") === "GET") return json([]);
    if (u === "/api/mail/sources" && init?.method === "POST") return json({ id: "s1", ...JSON.parse(String(init.body)) });
    if (u === "/api/mail/tags" && (init?.method ?? "GET") === "GET") return json([]);
    if (u.startsWith("/api/mail/threads/")) {
      const key = decodeURIComponent(u.slice("/api/mail/threads/".length));
      return json((opts.threads ?? []).find((t) => t.id === key) ?? {}, 200);
    }
    if (u.startsWith("/api/mail/threads")) return json(opts.threads ?? []);
    if (u === "/api/mail/accounts/a1/senders") return json(opts.senders ?? []);
    if (u === "/api/mail/send-to-atlas") return json({ id: "t_task1", title: "Mail" });
    return json({ ok: true });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const calls = (fn: ReturnType<typeof mockFetch>, url: string, method: string) =>
  fn.mock.calls.filter(([u, i]) => u === url && ((i as RequestInit | undefined)?.method ?? "GET") === method);

beforeEach(() => {
  useStore.getState().reset();
  window.location.hash = "#token=test-token";
  useMail.setState({ status: undefined, sources: [], threads: [], tags: [], threadFilter: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("Mail modal", () => {
  it("E opens Mail; typing in a textarea does not", async () => {
    mockFetch();
    useStore.getState().apply(snapshot([manager, worker], []));
    render(<App />);
    const box = document.createElement("textarea");
    document.body.appendChild(box);
    box.focus();
    await userEvent.keyboard("e");
    expect(screen.queryByRole("dialog", { name: "Mail" })).not.toBeInTheDocument();
    box.blur();
    box.remove();
    await userEvent.keyboard("e");
    expect(await screen.findByRole("dialog", { name: "Mail" })).toBeInTheDocument();
  });

  it("opens on agenticview:open-mail at the requested view", async () => {
    mockFetch({ senders: [] });
    useStore.getState().apply(snapshot([manager], []));
    render(<App />);
    act(() => window.dispatchEvent(new CustomEvent("agenticview:open-mail", { detail: { accountId: "a1", view: "sources" } })));
    const dialog = await screen.findByRole("dialog", { name: "Mail" });
    expect(within(dialog).getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
  });

  it("sender picker selects multiple senders and saves a latest-50 source", async () => {
    const fn = mockFetch({
      senders: [
        { email: "alice@x.com", name: "Alice", count: 4, lastDate: "2026-10-20T10:00:00Z" },
        { email: "bob@y.com", name: "Bob", count: 2, lastDate: "2026-10-19T10:00:00Z" },
        { email: "carol@z.com", name: "Carol", count: 1, lastDate: "2026-10-18T10:00:00Z" },
      ],
    });
    render(<MailModal onClose={() => undefined} initialView="sources" initialAccountId="a1" />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "alice@x.com" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "bob@y.com" }));
    expect(screen.getByRole("radio", { name: /Latest/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Check every 10 minutes/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Save & Pull" }));
    await waitFor(() => expect(calls(fn, "/api/mail/sources", "POST")).toHaveLength(1));
    expect(JSON.parse(String((calls(fn, "/api/mail/sources", "POST")[0]![1] as RequestInit).body))).toEqual({
      accountId: "a1",
      senders: ["alice@x.com", "bob@y.com"],
      amount: { kind: "latest", n: 50 },
      autoCheck: false,
    });
    await waitFor(() => expect(calls(fn, "/api/mail/sources/s1/pull", "POST")).toHaveLength(1));
  });

  it("sender filter narrows the list", async () => {
    mockFetch({
      senders: [
        { email: "alice@x.com", name: "Alice", count: 4, lastDate: "2026-10-20T10:00:00Z" },
        { email: "bob@y.com", name: "Bob", count: 2, lastDate: "2026-10-19T10:00:00Z" },
      ],
    });
    render(<MailModal onClose={() => undefined} initialView="sources" initialAccountId="a1" />);
    await screen.findByRole("checkbox", { name: "alice@x.com" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter senders" }), "bob");
    expect(screen.queryByRole("checkbox", { name: "alice@x.com" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "bob@y.com" })).toBeInTheDocument();
  });

  it("Send to Atlas sends the selected thread keys and note", async () => {
    const fn = mockFetch({ threads: [thread(), thread({ id: "a1_t2", gmailThreadId: "t2", subject: "Lunch" })] });
    render(<MailModal onClose={() => undefined} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Invoice question" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Note for Atlas" }), "Reply politely");
    await userEvent.click(screen.getByRole("button", { name: "Send to Atlas" }));
    await waitFor(() => expect(calls(fn, "/api/mail/send-to-atlas", "POST")).toHaveLength(1));
    expect(JSON.parse(String((calls(fn, "/api/mail/send-to-atlas", "POST")[0]![1] as RequestInit).body))).toEqual({
      threadKeys: ["a1_t1"],
      note: "Reply politely",
    });
  });

  it("flagged draft shows the check banner", async () => {
    mockFetch({
      threads: [thread({ drafts: [{ id: "d1", body: "Dear Alice", createdAt: "2026-10-21T10:00:00Z", flagged: true }] })],
    });
    render(<MailModal onClose={() => undefined} />);
    await userEvent.click(await screen.findByRole("button", { name: "Invoice question" }));
    expect(await screen.findByText("Check this: may not be just the reply")).toBeInTheDocument();
  });

  it("Send requires the confirm step", async () => {
    const fn = mockFetch({
      threads: [
        thread({
          drafts: [
            { id: "d2", body: "Newest reply", createdAt: "2026-10-22T10:00:00Z", flagged: false },
            { id: "d1", body: "Older reply", createdAt: "2026-10-21T10:00:00Z", flagged: false },
          ],
        }),
      ],
    });
    render(<MailModal onClose={() => undefined} />);
    await userEvent.click(await screen.findByRole("button", { name: "Invoice question" }));
    expect(await screen.findByText("Previous versions (1)")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Send…" })[0]!);
    const confirm = screen.getByRole("alertdialog", { name: "Send this reply?" });
    expect(within(confirm).getByText("alice@x.com")).toBeInTheDocument();
    expect(within(confirm).getByText("Re: Invoice question")).toBeInTheDocument();
    expect(within(confirm).getByText("Newest reply")).toBeInTheDocument();
    const sends = () => calls(fn, "/api/mail/drafts/a1_t1/d2/send", "POST");
    expect(sends()).toHaveLength(0);
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(sends()).toHaveLength(0);
    await userEvent.click(screen.getAllByRole("button", { name: "Send…" })[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Send email" }));
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect((sends()[0]![1] as RequestInit).body).toBe(JSON.stringify({ confirm: true }));
  });

  it("once one version was sent, Send is disabled on the other versions", async () => {
    mockFetch({
      threads: [
        thread({
          drafts: [
            { id: "d2", body: "Newest reply", createdAt: "2026-10-22T10:00:00Z", flagged: false },
            { id: "d1", body: "Older reply", createdAt: "2026-10-21T10:00:00Z", flagged: false, sentAt: "2026-10-21T11:00:00Z" },
          ],
        }),
      ],
    });
    render(<MailModal onClose={() => undefined} />);
    await userEvent.click(await screen.findByRole("button", { name: "Invoice question" }));
    expect(await screen.findByText("Previous versions (1)")).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send…" });
    expect(send).toBeDisabled();
    expect(screen.getByText(/another version of this reply was already sent/i)).toBeInTheDocument();
    // The other actions stay available.
    expect(screen.getByRole("button", { name: "Save to Gmail drafts" })).toBeEnabled();
  });

  it("draft edits save on blur", async () => {
    const fn = mockFetch({
      threads: [thread({ drafts: [{ id: "d1", body: "Hi", createdAt: "2026-10-21T10:00:00Z", flagged: false }] })],
    });
    render(<MailModal onClose={() => undefined} />);
    await userEvent.click(await screen.findByRole("button", { name: "Invoice question" }));
    const box = await screen.findByRole("textbox", { name: "Reply draft" });
    await userEvent.type(box, " there");
    expect(calls(fn, "/api/mail/drafts/a1_t1/d1", "PUT")).toHaveLength(0);
    act(() => box.blur());
    await waitFor(() => expect(calls(fn, "/api/mail/drafts/a1_t1/d1", "PUT")).toHaveLength(1));
    expect((calls(fn, "/api/mail/drafts/a1_t1/d1", "PUT")[0]![1] as RequestInit).body).toBe(JSON.stringify({ body: "Hi there" }));
  });

  it("mail text is rendered as text, not HTML", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    mockFetch({ threads: [thread({ messages: [{ ...thread().messages[0]!, text: evil }] })] });
    render(<MailModal onClose={() => undefined} />);
    await userEvent.click(await screen.findByRole("button", { name: "Invoice question" }));
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(document.querySelector(".modal img")).toBeNull();
    expect(screen.getByText("scan.pdf")).toBeInTheDocument();
  });

  it("a needsReconnect error offers to open Settings → Connections", async () => {
    mockFetch({
      handler: (u) =>
        u === "/api/mail/accounts/a1/senders"
          ? new Response(JSON.stringify({ error: "revoked", accountId: "a1", needsReconnect: true }), { status: 409 })
          : undefined,
    });
    const got = vi.fn();
    window.addEventListener("agenticview:open-settings", got as EventListener);
    render(<MailModal onClose={() => undefined} initialView="sources" initialAccountId="a1" />);
    expect(await screen.findByText("Reconnect me@x.com in Settings → Connections")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Connections" }));
    expect((got.mock.calls[0]![0] as CustomEvent).detail).toEqual({ tab: "connections" });
    window.removeEventListener("agenticview:open-settings", got as EventListener);
  });
});
