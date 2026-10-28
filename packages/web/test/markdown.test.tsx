import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SimpleMarkdown, markdownToPlainText } from "../src/hud/markdown";
import { ChatPanel } from "../src/hud/ChatPanel";
import { useStore } from "../src/state/store";
import { manager, snapshot, worker } from "./fixtures";

describe("SimpleMarkdown", () => {
  it("renders bold, italic, inline code, lists, code blocks and keeps line breaks", () => {
    const { container } = render(
      <SimpleMarkdown text={"Hello **x** and *y* with `z()`\nsecond line\n\n- one\n- two\n\n1. first\n2. second\n\n```ts\nconst a = 1;\n```"} />,
    );
    expect(container.querySelector("strong")!.textContent).toBe("x");
    expect(container.querySelector("em")!.textContent).toBe("y");
    expect(container.querySelector("p code")!.textContent).toBe("z()");
    expect(container.querySelector("p")!.textContent).toContain("\nsecond line");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("pre.smd-code code")!.textContent).toBe("const a = 1;");
  });

  it("escapes HTML in the source instead of injecting it", () => {
    const { container } = render(<SimpleMarkdown text={'<img src=x onerror="alert(1)"> **<b>hi</b>**'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector("strong")!.textContent).toBe("<b>hi</b>");
  });

  it("a code block still streaming (no closing fence) renders as code", () => {
    const { container } = render(<SimpleMarkdown text={"```\nnpm test"} />);
    expect(container.querySelector("pre code")!.textContent).toBe("npm test");
  });

  it("renders headings, quotes, rules and safe links", () => {
    const { container } = render(
      <SimpleMarkdown text={"## Subject: Hi\nBody line\n\n> quoted\n> more\n\n---\n\nSee [docs](https://x.dev) or [bad](javascript:alert(1))"} />,
    );
    expect(container.querySelector("h4.smd-h")!.textContent).toBe("Subject: Hi");
    expect(container.querySelector("p")!.textContent).toBe("Body line");
    expect(container.querySelector("blockquote")!.textContent).toBe("quoted\nmore");
    expect(container.querySelector("hr")).not.toBeNull();
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("https://x.dev");
    expect(links[0]!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toContain("[bad](javascript:alert(1))");
  });
});

describe("markdownToPlainText", () => {
  it("drops markers and fences but keeps list structure and link targets", () => {
    const md = "# Hi Sam\n\nThanks **so** much for the `report`.\n\n- one\n- two\n\n1. first\n\n```\nraw *text*\n```\n\nSee [the doc](https://x.dev).";
    expect(markdownToPlainText(md)).toBe(
      "Hi Sam\n\nThanks so much for the report.\n\n- one\n- two\n\n1. first\n\nraw *text*\n\nSee the doc (https://x.dev).",
    );
  });
});

describe("chat copy", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.getState().apply(snapshot([manager, worker]));
    useStore.getState().select(worker.id);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Copy on an agent reply puts clean plain text on the clipboard", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    useStore.getState().apply({ type: "run.event", taskId: "t", agentId: worker.id, event: { type: "text", text: "Dear **Sam**,\n- a" } });
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Copy reply" }));
    expect(writeText).toHaveBeenCalledWith("Dear Sam,\n- a");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("code blocks have their own Copy button that copies just the code", () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<SimpleMarkdown text={"Run:\n```\nnpm test\n```"} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("npm test");
  });
});

describe("chat markdown", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.getState().apply(snapshot([manager, worker]));
    useStore.getState().select(worker.id);
  });

  it("agent replies render markdown; user messages stay plain text", () => {
    useStore.getState().pushUser(worker.id, "please **do** it <b>now</b>");
    useStore.getState().apply({ type: "run.event", taskId: "t", agentId: worker.id, event: { type: "text", text: "Done: **x** is `fixed`.\n- a\n- b <script>alert(1)</script>" } });
    const { container } = render(<ChatPanel />);
    const agentMsg = container.querySelector(".msg-agent")!;
    expect(agentMsg.querySelector("strong")!.textContent).toBe("x");
    expect(agentMsg.querySelector("code")!.textContent).toBe("fixed");
    expect(agentMsg.querySelectorAll("li")).toHaveLength(2);
    expect(agentMsg.querySelector("script")).toBeNull();
    expect(agentMsg.textContent).toContain("<script>alert(1)</script>");
    const userMsg = container.querySelector(".msg-user")!;
    expect(userMsg.querySelector("strong")).toBeNull();
    expect(userMsg.querySelector("b")).toBeNull();
    expect(userMsg.textContent).toBe("please **do** it <b>now</b>");
  });
});
