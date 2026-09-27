import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setCustomProviders, type ProviderStatus, type ServerMessage, type UsageReport } from "@agenticview/shared";
import { splitHeaderChips } from "../src/hud/headerChips";
import { ProviderChips } from "../src/hud/ProviderChips";
import { SettingsModal } from "../src/hud/SettingsModal";
import { parseModelLines, slugOf } from "../src/hud/ProvidersPanel";
import { UsagePanel, fmtNum, usageRows } from "../src/hud/UsagePanel";
import { useStore } from "../src/state/store";
import * as ws from "../src/net/ws";
import { manager, worker, snapshot } from "./fixtures";

const st = (provider: string, ok = true, limited = false): ProviderStatus =>
  ({ provider, ok, ...(ok ? {} : { reason: "not installed" }), ...(limited ? { limit: { limited: true, errorType: "quota" } } : {}) }) as ProviderStatus;

const SIX = ["claude", "claude-session", "codex", "copilot", "antigravity", "gemini"].map((p) => st(p));

function withConfig(extra: Partial<Extract<ServerMessage, { type: "snapshot" }>> = {}) {
  const snap = snapshot([manager, worker]) as Extract<ServerMessage, { type: "snapshot" }>;
  useStore.getState().apply({ ...snap, ...extra });
}

beforeEach(() => {
  useStore.getState().reset();
  setCustomProviders([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  setCustomProviders([]);
});

describe("header chip overflow", () => {
  it("keeps up to four chips, then collapses the rest behind +N in the user's order", () => {
    expect(splitHeaderChips(SIX.slice(0, 4), undefined).hidden).toEqual([]);
    const { visible, hidden, all } = splitHeaderChips(SIX, ["gemini", "codex"]);
    expect(visible.map((p) => p.provider)).toEqual(["gemini", "codex", "claude", "claude-session"]);
    expect(hidden.map((p) => p.provider)).toEqual(["copilot", "antigravity"]);
    expect(all).toHaveLength(6);
    const five = splitHeaderChips([...SIX.slice(0, 4), st("custom:x")], undefined);
    expect(five.visible).toHaveLength(4);
    expect(five.hidden.map((p) => p.provider)).toEqual(["custom:x"]);
  });

  it("renders +N more; click and keyboard open a list of every provider, Escape closes", async () => {
    setCustomProviders([{ id: "local", label: "Local LLM", engine: "openai", baseUrl: "http://l/v1", models: [{ id: "qwen3" }], defaultModel: "qwen3", hasKey: false }]);
    useStore.setState({ providers: [...SIX.slice(0, 5), st("gemini", false), { ...st("custom:local"), limit: { limited: true, errorType: "rate-limit" } } as ProviderStatus] });
    render(<ProviderChips onSettings={vi.fn()} />);
    const more = screen.getByRole("button", { name: /3 more providers, 1 limited/ });
    expect(more).toHaveTextContent("+3 more");
    expect(more).toHaveAttribute("aria-expanded", "false");
    more.focus();
    await userEvent.keyboard("{Enter}");
    const panel = screen.getByRole("region", { name: "All providers" });
    expect(more).toHaveAttribute("aria-expanded", "true");
    const items = within(panel).getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(within(panel).getByText("Local LLM")).toBeInTheDocument();
    expect(within(panel).getByText("qwen3")).toBeInTheDocument();
    expect(within(panel).getByText("limited")).toBeInTheDocument();
    expect(within(panel).getByText("not installed")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "All providers" })).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

  it("follows the provider order from the server config", () => {
    useStore.setState({ providers: SIX, providerConfig: { customProviders: [], providerOrder: ["antigravity", "gemini", "claude", "codex", "copilot", "claude-session"], providerKeys: { claude: false, codex: false, gemini: false } } });
    const { container } = render(<ProviderChips />);
    const shown = [...container.querySelectorAll(".provider-compact [data-provider]")].map((e) => e.getAttribute("data-provider"));
    expect(shown).toEqual(["antigravity", "gemini", "claude", "codex"]);
  });
});

describe("Settings > Providers", () => {
  const cfg = {
    customProviders: [{ id: "proxy", label: "Proxy", engine: "anthropic" as const, baseUrl: "https://proxy.example", models: [{ id: "glm-5" }], defaultModel: "glm-5", hasKey: true }],
    providerOrder: ["codex", "claude", "claude-session", "copilot", "antigravity", "gemini", "custom:proxy"] as never,
    providerKeys: { claude: true, codex: false, gemini: false },
  };

  it("shows key state without values, saves a key through provider.setKey and notes login-only providers", async () => {
    const send = vi.fn();
    withConfig({ providers: [...SIX, st("custom:proxy")], providerConfig: cfg });
    useStore.setState({ send });
    render(<SettingsModal onClose={vi.fn()} initialTab="providers" />);
    const claude = screen.getByRole("article", { name: "Claude" });
    expect(within(claude).getByText("set")).toBeInTheDocument();
    const codex = screen.getByRole("article", { name: "Codex" });
    expect(within(codex).getByText("not set")).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "GitHub Copilot" })).getByText(/Login only/)).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "GitHub Copilot" })).queryByLabelText(/API key/)).not.toBeInTheDocument();
    const input = within(codex).getByLabelText("Codex API key");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.type(input, "sk-new");
    await userEvent.click(within(codex).getByRole("button", { name: "Save key" }));
    expect(send).toHaveBeenCalledWith({ type: "provider.setKey", provider: "codex", apiKey: "sk-new" });
    expect(input).toHaveValue("");
  });

  it("lists the one provider order (custom included) and saves order + failover subset", async () => {
    const send = vi.fn();
    withConfig({ providers: [...SIX, st("custom:proxy")], providerConfig: cfg });
    useStore.setState({ send, settings: { ...useStore.getState().settings!, failoverOrder: ["codex", "copilot"] } });
    render(<SettingsModal onClose={vi.fn()} initialTab="providers" />);
    const list = screen.getByRole("list", { name: "Provider order" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-provider"))).toEqual(["codex", "claude", "claude-session", "copilot", "antigravity", "gemini", "custom:proxy"]);
    await userEvent.click(screen.getByRole("button", { name: "Move Proxy up" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Use Proxy for failover" }));
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));
    const order = send.mock.calls.map((c) => c[0]).find((m) => m.type === "provider.order");
    expect(order.order).toEqual(["codex", "claude", "claude-session", "copilot", "antigravity", "custom:proxy", "gemini"]);
    const upd = send.mock.calls.map((c) => c[0]).find((m) => m.type === "settings.update");
    expect(upd.settings.failoverOrder).toEqual(["codex", "copilot", "custom:proxy"]);
  });

  it("adds a custom provider through customProvider.upsert", async () => {
    const send = vi.fn();
    withConfig({ providers: SIX, providerConfig: { ...cfg, customProviders: [] } });
    useStore.setState({ send });
    render(<SettingsModal onClose={vi.fn()} initialTab="providers" />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add custom provider" }));
    const form = screen.getByRole("form", { name: "Add custom provider" });
    await userEvent.type(within(form).getByLabelText("Name"), "Local Ollama");
    await userEvent.type(within(form).getByLabelText("Base URL"), "http://localhost:11434/v1");
    await userEvent.type(within(form).getByLabelText(/Models/), "qwen3-coder\nllama-4 | Llama 4");
    await userEvent.selectOptions(within(form).getByLabelText("Default model"), "llama-4");
    await userEvent.click(within(form).getByRole("button", { name: "Add provider" }));
    expect(send).toHaveBeenCalledWith({
      type: "customProvider.upsert",
      provider: { id: "local-ollama", label: "Local Ollama", engine: "openai", baseUrl: "http://localhost:11434/v1", models: [{ id: "qwen3-coder" }, { id: "llama-4", label: "Llama 4" }], defaultModel: "llama-4", apiKey: null },
    });
  });

  it("parses model lines and slugs", () => {
    expect(parseModelLines("a\n\n b | Bee \na\nc|x|y")).toEqual([{ id: "a" }, { id: "b", label: "Bee" }, { id: "c", label: "x|y" }]);
    expect(slugOf("  My LLM!! v2 ")).toBe("my-llm-v2");
  });

  it("tabs are a keyboard tablist", async () => {
    withConfig({ providers: SIX });
    render(<SettingsModal onClose={vi.fn()} />);
    const general = screen.getByRole("tab", { name: "General" });
    expect(general).toHaveAttribute("aria-selected", "true");
    general.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Providers" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Providers" })).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Usage" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Usage tab", () => {
  const bucket = (i: number, o: number, runs = 1) => ({ inputTokens: i, outputTokens: o, totalTokens: i + o, runs });
  const agg = (i: number, o: number) => ({ session: bucket(i, o), today: bucket(i, o), last7Days: bucket(i * 2, o * 2, 2) });
  const report: UsageReport = {
    agents: { [worker.id]: agg(12345, 678), gone: agg(1000, 10) },
    providers: { codex: agg(13345, 688) },
    models: [
      { provider: "codex", model: "gpt-6-sol", usage: agg(12345, 678) },
      { provider: "custom:local", model: "qwen3", usage: agg(1000, 10) },
    ],
    updatedAt: new Date().toISOString(),
  };

  it("builds rows with agent names and provider/model labels", () => {
    setCustomProviders([{ id: "local", label: "Local LLM", engine: "openai", baseUrl: "http://l/v1", models: [], defaultModel: null, hasKey: false }]);
    const rows = usageRows(report, (id) => (id === worker.id ? "Pixel" : undefined));
    expect(rows.agents.map((r) => [r.name, r.sub])).toEqual([["Pixel", undefined], ["gone", "removed agent"]]);
    expect(rows.models.map((r) => [r.name, r.sub])).toEqual([["Codex", "gpt-6-sol"], ["Local LLM", "qwen3"]]);
    expect(fmtNum(1234567)).toBe((1234567).toLocaleString());
  });

  it("renders in/out tables with separators and totals, plan bars, refresh and auto-refresh", async () => {
    const limits = {
      providers: {
        codex: { limit: { limited: false }, models: { "gpt-6-sol": { provider: "codex", model: "gpt-6-sol", fiveHour: { status: "reported", percentLeft: 72, usedPercent: 28, resetAt: new Date(Date.now() + 3_600_000).toISOString() }, weekly: { status: "reported", percentLeft: 18, usedPercent: 82 }, updatedAt: "" } } },
        "claude-session": { limit: { limited: false }, models: {} },
        gemini: { limit: { limited: true, errorType: "quota" }, models: {} },
      },
      updatedAt: new Date().toISOString(),
    };
    const fetchSpy = vi.spyOn(ws, "apiFetch").mockImplementation((path: string) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(path.includes("limits") ? limits : report) } as Response),
    );
    withConfig();
    render(<UsagePanel />);
    const byAgent = await screen.findByRole("table", { name: "Token usage by agent" });
    expect(within(byAgent).getByText("Pixel")).toBeInTheDocument();
    expect(within(byAgent).getAllByText((12345).toLocaleString()).length).toBeGreaterThan(0);
    const foot = byAgent.querySelector("tfoot")!;
    expect(foot).toHaveTextContent((13345).toLocaleString());
    expect(screen.getByRole("table", { name: "Token usage by provider and model" })).toBeInTheDocument();
    const bars = screen.getAllByRole("progressbar");
    expect(bars[0]).toHaveAttribute("aria-label", expect.stringMatching(/^5 hours: 72% left, resets in 1h/));
    expect(bars[1]).toHaveAttribute("aria-valuenow", "18");
    expect(screen.getByText(/agenticview-statusline/)).toBeInTheDocument();
    expect(screen.getByText("Gemini")).toBeInTheDocument();
    expect(screen.queryByText("not reported")).not.toBeInTheDocument();
    const calls = fetchSpy.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBe(calls + 2));
    expect(screen.getByRole("combobox", { name: "Auto-refresh" })).toHaveValue("off");
  });

  it("shows an empty state without runs", async () => {
    vi.spyOn(ws, "apiFetch").mockResolvedValue({ ok: true, json: () => Promise.resolve({ agents: {}, providers: {}, updatedAt: new Date().toISOString() }) } as Response);
    withConfig();
    render(<UsagePanel />);
    expect(await screen.findByText(/No token usage recorded yet/)).toBeInTheDocument();
  });
});

describe("custom providers in the agent form", () => {
  it("groups custom providers under Custom and offers their models", async () => {
    const { CreateAgentModal } = await import("../src/hud/CreateAgentModal");
    withConfig({
      providers: [...SIX, st("custom:local")],
      providerConfig: {
        customProviders: [{ id: "local", label: "Local LLM", engine: "openai", baseUrl: "http://l/v1", models: [{ id: "qwen3", label: "Qwen 3" }], defaultModel: "qwen3", hasKey: false }],
        providerOrder: ["claude", "claude-session", "codex", "copilot", "antigravity", "gemini", "custom:local"],
        providerKeys: { claude: false, codex: false, gemini: false },
      },
    });
    render(<CreateAgentModal onClose={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Provider" });
    const group = select.querySelector("optgroup[label='Custom']")!;
    expect(group).not.toBeNull();
    expect(group.textContent).toContain("Local LLM");
    await userEvent.selectOptions(select, "custom:local");
    const model = screen.getByRole("combobox", { name: "Model" });
    expect([...model.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Provider default", "Qwen 3", "Custom…"]);
  });
});

describe("header chips fit", () => {
  it("shows up to four, fewer when the header is narrow, all when they fit", async () => {
    const { chipsThatFit, estimateChipWidth } = await import("../src/hud/headerChips");
    const labels = ["Claude", "Claude Code session", "Codex", "GitHub Copilot", "Antigravity", "Gemini"].map((label) => ({ label }));
    expect(chipsThatFit(labels, 0)).toBe(4);
    expect(chipsThatFit(labels, 5000)).toBe(4);
    expect(chipsThatFit(labels.slice(0, 3), 5000)).toBe(3);
    const two = 78 + estimateChipWidth("Claude") + estimateChipWidth("Claude Code session") + 12;
    expect(chipsThatFit(labels, two)).toBe(2);
    expect(chipsThatFit(labels, 10)).toBe(1);
  });
});
