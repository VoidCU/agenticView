import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../src/hud/ui";

function Example() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open board</button>{open &&
    <Modal title="Board" onClose={() => setOpen(false)}>
      <input aria-label="Title" />
      <button>Save</button>
      <button disabled>Disabled</button>
      <button hidden>Hidden</button>
      <details><summary>Task</summary><button>Collapsed action</button></details>
    </Modal>}</>;
}

describe("Modal focus", () => {
  it("wraps Tab and Shift+Tab around eligible controls and restores the opener on Escape", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const opener = screen.getByRole("button", { name: "Open board" });
    await user.click(opener);
    const close = screen.getByRole("button", { name: "Close" });
    const summary = screen.getByText("Task");
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(summary).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("Title")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    await user.tab();
    expect(summary).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("contains programmatic focus and restores focus after backdrop dismissal", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const opener = screen.getByRole("button", { name: "Open board" });
    await user.click(opener);
    opener.focus();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("preserves focused fields across callback changes and uses the latest close handler", () => {
    const oldClose = vi.fn();
    const newClose = vi.fn();
    const { rerender } = render(<Modal title="Board" onClose={oldClose}><input aria-label="Title" /></Modal>);
    screen.getByLabelText("Title").focus();
    rerender(<Modal title="Board" onClose={newClose}><input aria-label="Title" /></Modal>);
    expect(screen.getByLabelText("Title")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(newClose).toHaveBeenCalledOnce();
    expect(oldClose).not.toHaveBeenCalled();
  });
});
