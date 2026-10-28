import { readFile } from "node:fs/promises";
/**
 * Shown when a runtime refuses an untrusted run (RunRequest.untrusted: a run that reads Gmail threads)
 * because the user has MCP servers configured for that provider that AgenticView cannot reliably turn off.
 */
export const UNTRUSTED_MCP_REFUSAL = "This agent's provider has your own MCP servers configured, which can't be switched off for an email reply. Assign email replies to an agent on another provider.";
/**
 * Whether a JSON config file names any MCP server (its `mcpServers` object) that `ignore` does not
 * cover. A missing file names none. A file that cannot be read or parsed, or whose `mcpServers` is not
 * an object, counts as configured: an untrusted run fails closed on anything it cannot vet.
 */
export async function hasUserMcpServers(file, ignore = () => false) {
    let text;
    try {
        text = await readFile(file, "utf8");
    }
    catch (e) {
        const code = e.code;
        return code !== "ENOENT" && code !== "ENOTDIR";
    }
    if (!text.trim())
        return false;
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return true;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return true;
    const servers = parsed.mcpServers;
    if (servers === undefined || servers === null)
        return false;
    if (typeof servers !== "object" || Array.isArray(servers))
        return true;
    return Object.keys(servers).some((name) => !ignore(name));
}
/** True when any of the files configures a user MCP server (see hasUserMcpServers). */
export async function anyUserMcpServers(files, ignore) {
    for (const f of files)
        if (await hasUserMcpServers(f, ignore))
            return true;
    return false;
}
//# sourceMappingURL=untrusted.js.map