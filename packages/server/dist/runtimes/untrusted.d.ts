/**
 * Shown when a runtime refuses an untrusted run (RunRequest.untrusted: a run that reads Gmail threads)
 * because the user has MCP servers configured for that provider that AgenticView cannot reliably turn off.
 */
export declare const UNTRUSTED_MCP_REFUSAL = "This agent's provider has your own MCP servers configured, which can't be switched off for an email reply. Assign email replies to an agent on another provider.";
/**
 * Whether a JSON config file names any MCP server (its `mcpServers` object) that `ignore` does not
 * cover. A missing file names none. A file that cannot be read or parsed, or whose `mcpServers` is not
 * an object, counts as configured: an untrusted run fails closed on anything it cannot vet.
 */
export declare function hasUserMcpServers(file: string, ignore?: (name: string) => boolean): Promise<boolean>;
/** True when any of the files configures a user MCP server (see hasUserMcpServers). */
export declare function anyUserMcpServers(files: string[], ignore?: (name: string) => boolean): Promise<boolean>;
