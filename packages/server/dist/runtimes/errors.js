/**
 * Extracts the real error lines from CLI stdout/stderr or thrown exception messages.
 * Filters out common non-error noise like "Reading prompt from stdin...", unwraps JSON
 * error payloads, and prioritizes actionable error messages.
 */
export function extractCliError(raw) {
    if (!raw || typeof raw !== "string")
        return "Unknown error";
    const trimmed = raw.trim();
    // Try parsing entire string as JSON (e.g. stringified error objects)
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
            if (typeof parsed.message === "string")
                return extractCliError(parsed.message);
            if (parsed.error && typeof parsed.error === "object") {
                if (typeof parsed.error.message === "string")
                    return extractCliError(parsed.error.message);
            }
        }
    }
    catch {
        // Not valid top-level JSON
    }
    // Strip common wrapper prefixes from CLI drivers / SDKs
    let cleaned = raw
        .replace(/^Codex Exec exited with (?:code \d+|signal \w+):\s*/i, "")
        .replace(/^Failed to parse item:\s*/i, "");
    const rawLines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const isNoise = (line) => {
        if (/^reading (?:prompt|additional input) from stdin\.\.\./i.test(line))
            return true;
        if (/^using model\b/i.test(line))
            return true;
        if (/^failed to parse item:\s*reading/i.test(line))
            return true;
        return false;
    };
    const filtered = rawLines.filter((l) => !isNoise(l));
    if (filtered.length === 0) {
        // If every line was noise, return the cleaned raw string or a generic fallback
        return cleaned.trim() || "CLI process exited with an error";
    }
    // Check if any line contains a JSON error payload
    for (let i = 0; i < filtered.length; i++) {
        const line = filtered[i];
        if (line.startsWith("{") && line.endsWith("}")) {
            try {
                const obj = JSON.parse(line);
                if (obj && typeof obj === "object") {
                    const msg = obj.error?.message ?? obj.message;
                    if (typeof msg === "string") {
                        filtered[i] = msg;
                    }
                }
            }
            catch {
                // ignore
            }
        }
    }
    // Prioritize lines with prominent error indicators
    const prominent = filtered.filter((l) => /^ERROR:/i.test(l) ||
        /usage limit/i.test(l) ||
        /rate limit/i.test(l) ||
        /quota/i.test(l) ||
        /unauthorized/i.test(l) ||
        /\b429\b/.test(l) ||
        /\b401\b/.test(l));
    if (prominent.length > 0) {
        return prominent.join("\n");
    }
    return filtered.join("\n");
}
/**
 * Classifies an error message into one of:
 * - "quota": monthly / token / credit usage limit or plan quota reached
 * - "rate-limit": requests per minute or temporary concurrency throttling (429)
 * - "auth": invalid credentials, expired session, login required
 * - "crash": unexpected process termination, OOM, segmentation fault, syntax error
 */
export function classifyError(errorText) {
    const text = (errorText || "").toLowerCase();
    // 1. Quota / credits / usage limit
    if (/usage limit/.test(text) ||
        /quota/.test(text) ||
        /credit balance/.test(text) ||
        /purchase more credits/.test(text) ||
        /out of credits/.test(text) ||
        /insufficient_quota/.test(text) ||
        /insufficient funds/.test(text) ||
        /billing/.test(text) ||
        /exceeded your.*quota/.test(text) ||
        /plan limit/.test(text)) {
        return "quota";
    }
    // 2. Rate limit / 429 / throttling
    if (/rate.?limit/.test(text) ||
        /too many requests/.test(text) ||
        /\b429\b/.test(text) ||
        /throttl/.test(text) ||
        /resource_exhausted/.test(text) ||
        /slow down/.test(text)) {
        return "rate-limit";
    }
    // 3. Auth / credentials / permissions
    if (/unauthorized/.test(text) ||
        /authentication/.test(text) ||
        /unauthenticated/.test(text) ||
        /invalid api key/.test(text) ||
        /\bapi.?key\b/.test(text) ||
        /\b401\b/.test(text) ||
        /\b403\b/.test(text) ||
        /forbidden/.test(text) ||
        /sign in with/.test(text) ||
        /not logged in/.test(text) ||
        /login required/.test(text) ||
        /permission denied/.test(text)) {
        return "auth";
    }
    // 4. Fallback to crash
    return "crash";
}
/**
 * Parses a reset timestamp (ISO string) from error messages or event payloads.
 * Supports:
 * - "try again at 7:12 AM"
 * - "resets at 18:30"
 * - "try again in 20 minutes"
 * - Unix timestamps (seconds or ms, e.g. resets_at: 1758873600)
 * - ISO 8601 strings
 */
export function parseResetAt(errorText, now = new Date()) {
    if (!errorText || typeof errorText !== "string")
        return undefined;
    // 1. Direct ISO timestamp
    const isoMatch = errorText.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\b/);
    if (isoMatch) {
        const d = new Date(isoMatch[1]);
        if (!isNaN(d.getTime()))
            return d.toISOString();
    }
    // 2. Unix timestamp (seconds or ms), e.g. "reset_at": 1758873600 or resets_at = 1758873600
    const unixMatch = errorText.match(/["']?(?:resets?_?at|reset)["']?\s*[:=]\s*(\d{10,13})\b/i);
    if (unixMatch) {
        const ts = parseInt(unixMatch[1], 10);
        const ms = ts > 1e11 ? ts : ts * 1000;
        return new Date(ms).toISOString();
    }
    // 3. "try again at 7:12 AM" or "resets at 7:12 PM"
    const timeMatch = errorText.match(/(?:try again|resets?|retry)\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i) ||
        errorText.match(/(?:at)\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        const ampm = timeMatch[4]?.toUpperCase();
        if (ampm === "PM" && hours < 12)
            hours += 12;
        else if (ampm === "AM" && hours === 12)
            hours = 0;
        const target = new Date(now);
        target.setHours(hours, minutes, seconds, 0);
        // If target is in the past relative to now, it refers to tomorrow
        if (target.getTime() <= now.getTime()) {
            target.setDate(target.getDate() + 1);
        }
        return target.toISOString();
    }
    // 4. Relative time: "try again in 20 minutes" or "resets in 2 hours"
    const relMatch = errorText.match(/(?:try again|resets?|retry)\s+in\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?)/i);
    if (relMatch) {
        const count = parseInt(relMatch[1], 10);
        const unit = relMatch[2].toLowerCase();
        let ms = 0;
        if (unit.startsWith("s"))
            ms = count * 1000;
        else if (unit.startsWith("m"))
            ms = count * 60 * 1000;
        else if (unit.startsWith("h"))
            ms = count * 3600 * 1000;
        else if (unit.startsWith("d"))
            ms = count * 86400 * 1000;
        if (ms > 0) {
            return new Date(now.getTime() + ms).toISOString();
        }
    }
    return undefined;
}
/**
 * Checks whether a limit is currently active (limited is true and resetAt has not passed).
 */
export function isLimitActive(limit, now = new Date()) {
    if (!limit || !limit.limited)
        return false;
    if (!limit.resetAt)
        return true;
    return new Date(limit.resetAt).getTime() > now.getTime();
}
//# sourceMappingURL=errors.js.map