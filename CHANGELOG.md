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

### Changed
- The default plan puts the lounge in the centre with the Manager's Office beside it, and My Office, Production and Research on the west side.
- Walk mode starts in My Office facing the wall screen; the *You* marker sits there on the mini-map, which now centres on the floor plan.
- The Manager starts production or research work only when you explicitly ask for it, routes it to the Producer or the Research team, and says so when that team does not exist.

### Upgrading
- The first start after upgrading migrates `rooms.json`, `office.json` and worker seats into `layout.json` once. `rooms.json` is left in place and no longer read.
