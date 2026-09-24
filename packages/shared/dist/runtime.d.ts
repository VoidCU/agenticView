export type RunEvent = {
    type: "text";
    text: string;
} | {
    type: "tool_start";
    name: string;
    input: unknown;
} | {
    type: "tool_end";
    name: string;
    ok: boolean;
    summary: string;
} | {
    type: "file_changed";
    path: string;
    kind: "create" | "modify" | "delete";
} | {
    type: "permission";
    id: string;
    tool: string;
    input: unknown;
} | {
    type: "status";
    text: string;
};
export type StopReason = "done" | "error" | "aborted" | "max_turns";
export interface RunResult {
    sessionId?: string;
    text: string;
    stopReason: StopReason;
    costUsd?: number;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    error?: string;
}
export type PromptPart = {
    type: "text";
    text: string;
} | {
    type: "image";
    path: string;
};
