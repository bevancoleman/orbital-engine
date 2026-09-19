# Contributing

## Setup

```bash
git clone https://github.com/bevancoleman/orbital-engine.git
cd orbital-engine
npm install
```

## Working on the engine

```bash
npm run typecheck
npm run lint
npm test          # 218+ unit tests
npm run build     # tsup — emits ESM + CJS + .d.ts to dist/
```

## Working on the examples

Each example is its own small app with its own `package.json`, and depends on the root package via `file:../..`:

```bash
npm run build            # build the root package first — the examples import from dist/
npm install --prefix examples/basic
npm run dev --prefix examples/basic
```

Swap `examples/basic` for `examples/with-models` as needed.

## End-to-end tests

The e2e suite drives both example apps in a real browser:

```bash
npm run build
npm ci --prefix examples/basic
npm ci --prefix examples/with-models
npx playwright install chromium
npx playwright test
```

If you're adding a feature that touches rendering behavior (not just pure math in `src/*.ts`), add or extend an e2e test — the unit tests can't exercise the actual React Three Fiber render path (no real WebGL context in Jest), so that's the only layer that catches a real regression there.

## Before opening a PR

- `npm run typecheck && npm run lint && npm test && npm run build` all pass.
- If you changed rendering behavior, `npx playwright test` passes too.
- Add a changeset describing the change: `npx changeset` — pick patch/minor/major and write a one-line summary. This drives the version bump and changelog entry on release; PRs without one are assumed to need no release note (docs/CI-only changes, etc).

## Design principles this codebase holds to

Worth reading before a non-trivial change, since these shape a lot of decisions in the code and its comments:

- **Real data, not fabricated defaults.** Where a value is a known real physical quantity (orbital elements, radii, colors), it's sourced from somewhere checkable (NASA JPL, IAU, USGS) and the source is stated. Where no real value exists, the code says so explicitly (see `note` fields in `solarSystemData.ts`) rather than inventing a plausible-looking placeholder.
- **True scale by default.** Body size and orbital distance are both real, proportional figures — see `scale.ts`. If a change would make scale configurable or approximate again, it needs a real justification, not just convenience.
- **Comments explain *why*, not *what*.** The code tends toward longer comments than is typical — that's deliberate, because a lot of the logic here encodes hard-won fixes for real, previously-observed bugs (see git history), and the reasoning is what keeps the next change from reintroducing them. If you're touching a function with one of these comments, read it first.
