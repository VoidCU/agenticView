export interface PageLike {
    setViewportSize(size: {
        width: number;
        height: number;
    }): Promise<void>;
    goto(url: string, opts?: {
        waitUntil?: "load" | "domcontentloaded" | "networkidle";
        timeout?: number;
    }): Promise<unknown>;
    screenshot(opts: {
        path: string;
        fullPage?: boolean;
    }): Promise<unknown>;
}
export interface BrowserLike {
    newPage(): Promise<PageLike>;
    close(): Promise<void>;
}
export interface ScreenshotOptions {
    width?: number;
    height?: number;
    fullPage?: boolean;
    launch?: () => Promise<BrowserLike>;
}
export declare class ScreenshotUnavailableError extends Error {
    constructor();
}
/** Lazily import Playwright and launch headless Chromium. */
export declare function launchChromium(): Promise<BrowserLike>;
/** Capture `url` to `<outDir>/shot-<id>.png`. */
export declare function takeScreenshot(url: string, outDir: string, opts?: ScreenshotOptions): Promise<{
    path: string;
}>;
