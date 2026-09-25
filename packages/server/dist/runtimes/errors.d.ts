import type { ErrorClassification, LimitInfo } from "@agenticview/shared";
/**
 * Extracts the real error lines from CLI stdout/stderr or thrown exception messages.
 * Filters out common non-error noise like "Reading prompt from stdin...", unwraps JSON
 * error payloads, and prioritizes actionable error messages.
 */
export declare function extractCliError(raw: string): string;
/**
 * Classifies an error message into one of:
 * - "quota": monthly / token / credit usage limit or plan quota reached
 * - "rate-limit": requests per minute or temporary concurrency throttling (429)
 * - "auth": invalid credentials, expired session, login required
 * - "crash": unexpected process termination, OOM, segmentation fault, syntax error
 */
export declare function classifyError(errorText: string): ErrorClassification;
/**
 * Parses a reset timestamp (ISO string) from error messages or event payloads.
 * Supports:
 * - "try again at 7:12 AM"
 * - "resets at 18:30"
 * - "try again in 20 minutes"
 * - Unix timestamps (seconds or ms, e.g. resets_at: 1758873600)
 * - ISO 8601 strings
 */
export declare function parseResetAt(errorText: string, now?: Date): string | undefined;
/**
 * Checks whether a limit is currently active (limited is true and resetAt has not passed).
 */
export declare function isLimitActive(limit?: LimitInfo, now?: Date): boolean;
