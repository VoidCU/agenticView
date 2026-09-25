#!/usr/bin/env node
import { type Instance } from "./instances.js";
import { type SessionTask } from "./runtimes/session.js";
/** Find the office for `start` or its nearest ancestor with one running, else the hub. */
export declare function discoverOffice(start: string): Promise<Instance | undefined>;
export declare function formatTask(t: SessionTask): string;
export declare function main(): Promise<void>;
