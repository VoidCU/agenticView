import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The HUD columns sit over the canvas; only their children may take the pointer, so a drag that
// starts beside a collapsed Tasks/Chat tab reaches the canvas (orbit + selection suppression).
const css = readFileSync(join(__dirname, "../src/styles.css"), "utf8");

/** Body of the first top-level rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("HUD side columns are pointer-transparent", () => {
  it.each([".hud-left", ".hud-right"])("%s has pointer-events: none", (sel) => {
    expect(rule(sel)).toContain("pointer-events: none");
  });
  it("their children stay interactive", () => {
    expect(css).toContain(".hud-left > *, .hud-right > * { pointer-events: auto; }");
  });
});
