import { z } from "zod";
import type { Agent } from "@agenticview/shared";
import { join } from "node:path";
import type { BridgeTool } from "../runtimes/types.js";
import { takeScreenshot, type ScreenshotOptions } from "../screenshot/screenshot.js";
import { projectRoot } from "../store/paths.js";

export interface WorkerToolContext {
  projectPath: string;
  agent: Agent;
  screenshot?: (url: string, outDir: string, opts: ScreenshotOptions) => Promise<{ path: string }>;
}

/** Bridge tools available to a worker run, gated by the agent's tool allowance. */
export function workerTools(ctx: WorkerToolContext): BridgeTool[] {
  const tools: BridgeTool[] = [];
  if (ctx.agent.tools.screenshot) {
    const shoot = ctx.screenshot ?? takeScreenshot;
    tools.push({
      name: "take_screenshot",
      description: "Capture a screenshot of a running web page (http or https URL, e.g. your dev server) and return the saved PNG path so you can look at it.",
      schema: {
        url: z.string().describe("http(s) URL to capture"),
        fullPage: z.boolean().optional().describe("Capture the full scrollable page"),
      },
      handler: async (args) => {
        try {
          const opts: ScreenshotOptions = {};
          if (typeof args.fullPage === "boolean") opts.fullPage = args.fullPage;
          const { path } = await shoot(String(args.url), join(projectRoot(ctx.projectPath), "uploads"), opts);
          return `screenshot: ${path}`;
        } catch (e) {
          return `ERROR: ${(e as Error).message}`;
        }
      },
    });
  }
  return tools;
}
