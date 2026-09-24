import { TRANSITIONS } from "@agenticview/shared";
export class IllegalTransitionError extends Error {
    from;
    to;
    constructor(from, to) {
        super(`Illegal task transition: ${from} -> ${to}`);
        this.from = from;
        this.to = to;
        this.name = "IllegalTransitionError";
    }
}
export function canTransition(from, to) {
    return TRANSITIONS[from].includes(to);
}
export function assertTransition(from, to) {
    if (!canTransition(from, to))
        throw new IllegalTransitionError(from, to);
}
//# sourceMappingURL=transitions.js.map