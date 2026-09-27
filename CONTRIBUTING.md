# Contributing to AgenticView

Thanks for looking under the hood! Forks and pull requests are welcome.

## Ground rules

- **`main` is protected.** All changes land through a pull request, and both CI jobs
  (`test (ubuntu-latest)` and `test (windows-latest)`) must pass before merge.
- **Node 22+** is required. `npm ci` at the repo root installs every workspace.
- **Built bundles are committed.** The `dist/` folders in `packages/shared`, `packages/server`
  and `packages/web` must match a clean build — CI rejects the PR otherwise. After source
  changes run `npm run build` and commit the rebuilt bundles with your change.
- **Plain commit messages.** No AI attribution lines (`Co-Authored-By`, "Generated with", …).

## Before you open a PR

Run the full check set from the repo root:

```sh
npx vitest run                     # unit + integration tests (all workspaces)
npm run typecheck                  # shared + server
npx tsc --noEmit -p packages/web   # web
npm run build                      # rebuilds committed dist
npm run test:e2e                   # Playwright smoke tests
```

Optional, for scene/UI changes: `AGENTICVIEW_SCREENSHOTS=1 npm run test:e2e` regenerates review
screenshots in `e2e/screenshots/` (gitignored — attach interesting ones to the PR instead).

## What makes a change easy to merge

- New behaviour comes with a test beside the code it tests.
- Scene geometry and colliders derive from the same constants (see `packages/web/src/scene/kit.ts`);
  the phantom-collider audit (`packages/web/test/phantomColliders.test.ts`) will fail your PR if the
  visible world and the collision world drift apart.
- Wire/protocol changes stay backward compatible: new fields optional, old JSON still loads.
- Keep the 3D scene cheap: no per-frame allocations, throttle canvas textures, share materials.

## Trying your changes

```sh
node bin/agenticview.mjs open --project <some folder>
```

`AGENTICVIEW_FAKE=1` gives you a demo office with scripted agents and no credentials; use a
temporary `AGENTICVIEW_HOME` so you don't touch your real office state.

## Releases

Maintainer-driven: versions are bumped across the six manifests and a `v*` tag triggers the
release workflow (see the "Releasing" section in the README). PRs never bump versions.
