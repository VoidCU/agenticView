import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SimpleMarkdown } from "../src/hud/markdown";
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
