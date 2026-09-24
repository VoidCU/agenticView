export function xpFor(kind, role) {
    if (role === "worker")
        return kind === "work" ? 10 : kind === "chat" ? 2 : 0;
    return kind === "request" ? 5 : 0;
}
export function levelFor(xp) {
    return Math.floor(Math.sqrt(xp / 25)) + 1;
}
//# sourceMappingURL=xp.js.map