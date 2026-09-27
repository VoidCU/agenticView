import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsModal } from "../src/hud/SettingsModal";
import { useStore } from "../src/state/store";
import { manager, snapshot } from "./fixtures";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().apply(snapshot([manager]));
});

async function setValue(label: string, value: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

describe("Settings: Office life", () => {
  it("shows the idle roll defaults as percentages and sends idleBehaviour with settings.update", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} initialTab="office" />);
    expect(screen.getByRole("group", { name: "Office life" })).toBeInTheDocument();
    expect(screen.getByLabelText("Stay at desk percent")).toHaveValue(40);
    expect(screen.getByLabelText("Visit a colleague or board percent")).toHaveValue(25);
    expect(screen.getByLabelText("Go to the lounge percent")).toHaveValue(35);
    expect(screen.getByText(/half the lounge spots/)).toBeInTheDocument();

    await setValue("Stay at desk percent", "50");
    await setValue("Visit a colleague or board percent", "30");
    await setValue("Go to the lounge percent", "20");
    await setValue("Idle lounge minutes", "5");
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    const msg = send.mock.calls.map((c) => c[0]).find((m) => m.type === "settings.update");
    expect(msg.type).toBe("settings.update");
    expect(msg.settings.idleLoungeMinutes).toBe(5);
    expect(msg.settings.idleBehaviour).toMatchObject({ stayChance: 0.5, visitChance: 0.3, loungeChance: 0.2, minRollSeconds: 120, maxRollSeconds: 240 });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the saved roll window and reads existing chances", () => {
    useStore.setState({ settings: { ...useStore.getState().settings!, idleBehaviour: { stayChance: 0.1, visitChance: 0.6, loungeChance: 0.3, minRollSeconds: 30, maxRollSeconds: 60, visitSeconds: 20 } } });
    render(<SettingsModal onClose={vi.fn()} initialTab="office" />);
    expect(screen.getByLabelText("Stay at desk percent")).toHaveValue(10);
    expect(screen.getByLabelText("Visit a colleague or board percent")).toHaveValue(60);
  });

  it("blocks saving until the three chances add up to 100", async () => {
    const send = vi.fn();
    useStore.setState({ send });
    render(<SettingsModal onClose={vi.fn()} initialTab="office" />);
    await setValue("Go to the lounge percent", "50");
    expect(screen.getByRole("alert")).toHaveTextContent("add up to 100 (now 115)");
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
    expect(screen.getByLabelText("Stay at desk percent")).toHaveAttribute("aria-invalid", "true");
    await setValue("Go to the lounge percent", "35");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();
  });
});
