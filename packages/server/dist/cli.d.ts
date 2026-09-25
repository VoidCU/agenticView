#!/usr/bin/env node
export declare const repoRoot: string;
export declare const USAGE = "AgenticView \u2014 a 3D office for your coding agents\n\nUsage:\n  agenticview open --project <path> [--no-browser] [--port N]   open the office for a project\n  agenticview hub [--no-browser] [--port N]                      open the global hub\n  agenticview close [--project <path> | --hub | --all]           close a running office (default: this folder's)\n  agenticview hook                                               (used by plugin hooks; reads stdin)\n  agenticview record-plugin-root <path>                          remember where the plugin lives\n  agenticview --help\n";
export declare function openBrowser(url: string): void;
export declare function main(argv: string[]): Promise<number>;
