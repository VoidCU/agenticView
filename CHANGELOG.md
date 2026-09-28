# Changelog

Release notes for tagged versions are generated on GitHub. This file collects what has landed since the last release.

## Unreleased

### Added
- **New rooms.** My Office (your own room: an executive desk facing a big social-hub wall screen), a Production Room (the Producer's edit desks, a green screen and a big screen that shows a *PRODUCTION* slate when idle and *ON AIR* with the running task's title) and a Research Room (a reading table, tall bookshelves, a pinboard and a globe). Production and research rooms have their own task boards.
- **Office layout as data.** The floor plan lives in `.agenticview/layout.json`; changes are validated, saved and broadcast, and the scene, walls and walk-mode colliders rebuild live. Walls that carry a big screen have no doorway.
- **Layout editor** (Settings > Layout): move or swap rooms, add, change or remove rooms on any hex, rename rooms, with live validation and a keyboard-only flow. Backed by token-gated `GET` / `PUT /api/layout`.
- **Manager layout tools:** `set_layout`, `move_room`, `set_room_kind` and `remove_room`; `add_room` now also adds production and research rooms. Manager only, and used only when you ask for a layout change.
- **Connections** (Settings > Connections): placeholders for Instagram and Meta, the future feed of the My Office wall screen (*Coming soon*). Clicking the wall screen in walk mode opens this tab.
- *Move to room* in an agent's menu.
- **Designated desks.** Every worker owns one desk (its `workSeat`, never shared) and sits there whenever it works, except in brainstorm meetings. Idle workers still wander; one sitting at another worker's desk gets up when the owner starts work. Dragging a worker, `move_worker` and `arrange_workers` change designated desks (taking another worker's desk swaps the two), and `list_spaces` shows whose desk each seat is. Designated desks exist only in work rooms (pods, Production Room, Research Room): a move to the meeting room or lounge is a temporary seat, and desk changes are serialized so simultaneous moves can never share a desk.

### Changed
- The default plan puts the lounge in the centre with the Manager's Office beside it, and My Office, Production and Research on the west side.
- Walk mode starts in My Office facing the wall screen; the *You* marker sits there on the mini-map, which now centres on the floor plan.
- The Manager starts production or research work only when you explicitly ask for it, routes it to the Producer or the Research team, and says so when that team does not exist.
- **The Manager no longer waits for workers.** `await_tasks` is gone: after `assign_task` the Manager ends its turn and its request becomes *delegated* (shown as *With the team*), so the Manager is idle and free to chat. When all of a request's workers finish, or one fails, the office wakes the Manager in the same conversation with a compact `## Worker results` block (only outcomes it has not seen yet), and it assigns follow-ups, retries, or reports. Requests delegated before a restart are woken on the next start. A session-backed Manager no longer occupies a session slot while its workers run, so the capacity-1 deadlock guard is gone.
- Messaging the Manager while it works no longer starts a second, fresh conversation. The message joins the running turn on its next tool result; a message the turn ends before reading becomes one follow-up request on the same conversation. A message sent while the Manager waits on a question answers it.

### Fixed
- Walk-mode whiteboards: the overview sticky notes no longer cover the task rows up close, and the *+N more* footer no longer overlaps the last row.
- The rock-paper-scissors scoreboard adds players from their first result, keeps one order (most wins, then fewest losses) in the popup, the lounge board and the server, and the lounge board refreshes when standings change.

### Upgrading
- On the first start after upgrading, every worker adopts its current desk as its designated desk; duplicates and desks that no longer exist move to a free desk (logged once).
- The first start after upgrading migrates `rooms.json`, `office.json` and worker seats into `layout.json` once. `rooms.json` is left in place and no longer read.
