import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { newId } from "@agenticview/shared";
export class ScreenshotUnavailableError extends Error {
    constructor() {
        super("Screenshots need Playwright's Chromium. Run: npx playwright install chromium (inside the AgenticView plugin folder)");
        this.name = "ScreenshotUnavailableError";
    }
}
/** Lazily import Playwright and launch headless Chromium. */
export async function launchChromium() {
    let pw;
    try {
        pw = (await import("playwright"));
    }
    catch {
        throw new ScreenshotUnavailableError();
    }
    try {
        return await pw.chromium.launch({ headless: true });
    }
    catch {
        throw new ScreenshotUnavailableError();
    }
}
function assertHttpUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error("Only http(s) URLs can be captured");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        throw new Error("Only http(s) URLs can be captured");
}
/** Capture `url` to `<outDir>/shot-<id>.png`. */
export async function takeScreenshot(url, outDir, opts = {}) {
    assertHttpUrl(url);
    await mkdir(outDir, { recursive: true });
    const path = join(outDir, `shot-${newId("u")}.png`);
    const browser = await (opts.launch ?? launchChromium)();
    try {
        const page = await browser.newPage();
        await page.setViewportSize({ width: opts.width ?? 1280, height: opts.height ?? 800 });
        await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
        await page.screenshot({ path, fullPage: opts.fullPage ?? false });
        return { path };
    }
    finally {
        await browser.close().catch(() => undefined);
    }
}
//# sourceMappingURL=screenshot.js.map