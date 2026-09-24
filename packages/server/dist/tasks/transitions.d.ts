import { type TaskStatus } from "@agenticview/shared";
export declare class IllegalTransitionError extends Error {
    readonly from: TaskStatus;
    readonly to: TaskStatus;
    constructor(from: TaskStatus, to: TaskStatus);
}
export declare function canTransition(from: TaskStatus, to: TaskStatus): boolean;
export declare function assertTransition(from: TaskStatus, to: TaskStatus): void;
