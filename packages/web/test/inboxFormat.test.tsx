import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox } from "../src/hud/Inbox";
import { QuestionToast } from "../src/hud/QuestionToast";
import { useStore } from "../src/state/store";
import { manager, snapshot, task, worker } from "./fixtures";

const QUESTION = "Which database should I use?\n\nOptions:\n- **Postgres** (already in `docker-compose.yml`)\n- SQLite for tests\n\nRun `npm run db:migrate` after <b>choosing</b>.";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().apply(snapshot([manager, worker], [task({ id: "t_db", title: "Set up the persistence layer", status: "waiting" })]));
  useStore.getState().apply({ type: "question.request", id: "q1", agentId: worker.id, taskId: "t_db", question: QUESTION });
});

describe("inbox formatting", () => {
  it("shows agent + task as a header, the question paragraphed with code, and the answer controls separately", () => {
    render(<Inbox onClose={() => undefined} />);
    const item = screen.getByTestId("inbox-question-q1");
    const header = item.querySelector(".inbox-item-header")!;
    expect(header.textContent).toContain("Pixel");
    expect(item.querySelector(".inbox-item-task")!.textContent).toBe("Set up the persistence layer");
    const body = item.querySelector(".inbox-question-text")!;
    expect(body.querySelectorAll("p").length).toBeGreaterThanOrEqual(3);
    expect(body.querySelectorAll("li")).toHaveLength(2);
    expect(body.querySelector("strong")!.textContent).toBe("Postgres");
    expect([...body.querySelectorAll("code")].map((c) => c.textContent)).toEqual(["docker-compose.yml", "npm run db:migrate"]);
    // HTML stays text.
    expect(body.querySelector("b")).toBeNull();
    expect(body.textContent).toContain("<b>choosing</b>");
    // Controls sit in their own row, after the body.
    const actions = item.querySelector(".inbox-actions-row")!;
    expect(actions.querySelector("input")).not.toBeNull();
    expect(body.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("limit notes keep their line breaks", () => {
    useStore.getState().apply({ type: "limit.request", id: "l1", agentId: worker.id, taskId: "t_db", reason: "Rate limited by the provider.\nRetry after the reset.", suggested: { provider: "codex" } });
    render(<Inbox onClose={() => undefined} />);
    const reason = screen.getByTestId("inbox-limit-l1").querySelector(".inbox-limit-reason p")!;
    expect(reason.textContent).toBe("Rate limited by the provider.\nRetry after the reset.");
  });

  it("the question toast uses the same structure", () => {
    const { container } = render(<QuestionToast />);
    expect(container.querySelector(".toast-task")!.textContent).toBe("Set up the persistence layer");
    expect(container.querySelector(".toast-question-text li strong")!.textContent).toBe("Postgres");
  });
});
