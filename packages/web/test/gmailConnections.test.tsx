import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GmailConnections } from "../src/hud/GmailConnections";
import { useMail } from "../src/state/mail";

const ACK = "agenticview.mail.privacyAck";

function mockFetch(status: unknown) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (u === "/api/mail/status") return json(status);
    if (u === "/api/mail/connect") return json({ authUrl: "https://accounts.google.com/auth?x=1" });
    if (u.startsWith("/api/mail/accounts/") && init?.method === "DELETE") return json({ ok: true });
    return json({});
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  useMail.setState({ status: undefined, sources: [], threads: [], tags: [] });
  try {
    localStorage.removeItem(ACK);
  } catch {
    /* ignore */
  }
});
afterEach(() => vi.unstubAllGlobals());

describe("GmailConnections", () => {
  it("shows setup guide when no client", async () => {
    mockFetch({ clientConfigured: false, accounts: [] });
    render(<GmailConnections />);
    expect(await screen.findByText(/Desktop app/)).toBeInTheDocument();
    expect(screen.getByLabelText("Client secret")).toHaveAttribute("type", "password");
  });

  it("connect requires privacy acknowledgement then opens auth URL", async () => {
    mockFetch({ clientConfigured: true, accounts: [] });
    const open = vi.fn();
    vi.stubGlobal("open", open);
    render(<GmailConnections />);
    await userEvent.click(await screen.findByRole("button", { name: "Connect a Gmail account" }));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText("Emails you send to Atlas are shared with the AI provider your agents use.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "I understand" }));
    await userEvent.click(screen.getByRole("button", { name: "Connect a Gmail account" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://accounts.google.com/auth?x=1", "_blank", "noopener"));
    expect(localStorage.getItem(ACK)).toBe("1");
  });

  it("shows Reconnect for needsReconnect accounts", async () => {
    mockFetch({ clientConfigured: true, accounts: [{ id: "a1", email: "me@x.com", connectedAt: "2026-10-01T00:00:00Z", needsReconnect: true }] });
    render(<GmailConnections />);
    expect(await screen.findByText("me@x.com")).toBeInTheDocument();
    expect(screen.getByText("Reconnect")).toBeInTheDocument();
  });

  it("disconnect calls DELETE /api/mail/accounts/:id", async () => {
    const fn = mockFetch({ clientConfigured: true, accounts: [{ id: "a1", email: "me@x.com", connectedAt: "2026-10-01T00:00:00Z" }] });
    render(<GmailConnections />);
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect me@x.com" }));
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => u === "/api/mail/accounts/a1" && (i as RequestInit).method === "DELETE")).toBe(true));
  });

  it("Choose senders opens the mail view", async () => {
    mockFetch({ clientConfigured: true, accounts: [{ id: "a1", email: "me@x.com", connectedAt: "2026-10-01T00:00:00Z" }] });
    const got = vi.fn();
    window.addEventListener("agenticview:open-mail", got as EventListener);
    render(<GmailConnections />);
    await userEvent.click(await screen.findByRole("button", { name: "Choose senders" }));
    expect((got.mock.calls[0]![0] as CustomEvent).detail).toEqual({ accountId: "a1", view: "sources" });
    window.removeEventListener("agenticview:open-mail", got as EventListener);
  });
});
