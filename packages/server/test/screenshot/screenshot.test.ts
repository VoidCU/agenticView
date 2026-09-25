import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takeScreenshot, ScreenshotUnavailableError, type BrowserLike } from "../../src/screenshot/screenshot.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "av-shot-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakeBrowser(log: string[]): BrowserLike {
  return {
    async newPage() {
      return {
        async setViewportSize(v: { width: number; height: number }) { log.push(`viewport ${v.width}x${v.height}`); },
        async goto(url: string) { log.push(`goto ${url}`); },
        async screenshot(o: { path: string; fullPage?: boolean }) { log.push(`shot full=${Boolean(o.fullPage)}`); await (await import("node:fs/promises")).writeFile(o.path, PNG); return PNG; },
      };
    },
    async close() { log.push("close"); },
  };
}

describe("takeScreenshot", () => {
  it("writes a png under the out dir and closes the browser", async () => {
    const log: string[] = [];
    const res = await takeScreenshot("http://localhost:3000/", dir, { launch: async () => fakeBrowser(log) });
    expect(res.path.startsWith(dir)).toBe(true);
    expect(res.path).toMatch(/shot-u_[0-9a-f]{8}\.png$/);
    expect(await readFile(res.path)).toEqual(PNG);
    expect(log).toEqual(["viewport 1280x800", "goto http://localhost:3000/", "shot full=false", "close"]);
  });

  it("honours width, height and fullPage", async () => {
    const log: string[] = [];
    await takeScreenshot("https://example.com", dir, { width: 390, height: 844, fullPage: true, launch: async () => fakeBrowser(log) });
    expect(log[0]).toBe("viewport 390x844");
    expect(log[2]).toBe("shot full=true");
  });

  it("rejects non-http urls before launching anything", async () => {
    let launched = false;
    await expect(takeScreenshot("file:///etc/passwd", dir, { launch: async () => { launched = true; return fakeBrowser([]); } })).rejects.toThrow(/Only http\(s\) URLs/);
    await expect(takeScreenshot("not a url", dir, { launch: async () => fakeBrowser([]) })).rejects.toThrow(/Only http\(s\) URLs/);
    expect(launched).toBe(false);
  });

  it("closes the browser even when the page fails", async () => {
    const log: string[] = [];
    const broken: BrowserLike = { async newPage() { throw new Error("no page"); }, async close() { log.push("close"); } };
    await expect(takeScreenshot("http://localhost/", dir, { launch: async () => broken })).rejects.toThrow("no page");
    expect(log).toEqual(["close"]);
  });

  it("explains how to install playwright when it is missing", async () => {
    const err = new ScreenshotUnavailableError();
    expect(err.message).toMatch(/npx playwright install chromium/);
    await expect(takeScreenshot("http://localhost/", dir, { launch: async () => { throw new ScreenshotUnavailableError(); } })).rejects.toThrow(ScreenshotUnavailableError);
  });
});
