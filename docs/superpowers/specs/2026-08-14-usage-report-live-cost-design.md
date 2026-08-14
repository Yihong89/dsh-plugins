# dsh-usage-report: live cost in the web composer dock

Date: 2026-08-14

## Context

`dsh-usage-report` is a host-plane plugin that computes per-session token usage
and estimated cost. Today the report is only surfaced on demand via the `/usage`
command and the `usage_report` model tool.

Goal: show the **current session's estimated cost live in the web UI**, without
running a command, so the user can see spend accumulate as a session runs.

## Approach

Make `dsh-usage-report` a **dual-plane plugin**: keep the existing host half
unchanged, and add a **client half** that renders a compact, color-coded cost
readout in the web composer dock.

The host's `usageReport` session-projection unit already folds provider-reported
usage into a per-session cost. The browser reads that value through dsh's
push-model projection store (`useProjection('usageReport')`), so the client half
needs no new host RPC or computation — it just subscribes and renders.

Placement: the `conversation.composer.dock` slot, where the session stats line
("17% of context used", turn/step counts) already renders. This is the same
third-party extension point used by `dsh-balance-meter` and `ui-goal`.

Note: the originally-preferred placement — per-session cost in the sidebar
session list — was rejected because `ui-workspace`'s session rows expose no
third-party slot; reaching it would require patching core dsh code.

## Architecture

```
dsh-usage-report/
  src/            (host half — unchanged)
    index.ts      projection unit + /usage command + usage_report tool
    usage-fold.ts, pricing.ts, format.ts, types.ts
  client/         (NEW client half)
    index.ts      ClientContext plugin: registers the dock entry
    CostMeter.tsx renders the live cost readout
```

## Components

### Client plugin entry (`client/index.ts`)

- A `ClientContext` plugin (the `@deepseek-ai/dsh-client-runtime/client` pattern).
- `inject = ['sessions', 'slots']` (and locale registration if needed).
- Registers one entry into the `conversation.composer.dock` list slot with a
  stable `id` (e.g. `usage-cost`) and an `order` that keeps it after the
  built-in stats line.

### CostMeter component

- Uses `useProjection('usageReport')` to read the current session's
  `UsageReportValue`.
- Renders a compact readout such as `$0.42` that re-renders on every push.
- Color-coded by estimated cost magnitude:
  - green: cost < `thresholdLow` (default $1.00)
  - amber: `thresholdLow` ≤ cost < `thresholdHigh` (default $5.00)
  - red: cost ≥ `thresholdHigh`
- No session or no projection value yet → renders nothing (graceful).

## Data flow

```
host: usageReport projection (existing) folds usage → cost
   ↓ push model (ProjectionValueStore)
client: useProjection('usageReport') → CostMeter re-renders on each push
```

## Configuration

New optional plugin config, settable from the profile `cordis.yml` entry:

| Field | Default | Meaning |
|---|---|---|
| `thresholdLow` | `1.0` | cost below this (USD) renders green |
| `thresholdHigh` | `5.0` | cost at/above this renders red; between is amber |
| `costDecimals` | host default (6) | decimal places for the displayed USD |

`thresholdLow` < `thresholdHigh` is validated at load (fail loud); otherwise the
client falls back to defaults.

## Error handling

- No active session / projection absent → render nothing.
- Config validation failures → fail loud at load (matching the host plugin's
  existing behavior).
- A session with no reported usage → `$0.00`, green.

## Testing

- Keep the existing 11 host tests (`usage-fold`) unchanged.
- Add a client component test: feed a `UsageReportValue` via the projection
  hook, assert the rendered text and the color class at green/amber/red
  boundaries (including boundary values).
- Real boot smoke: boot `dsh web` with the plugin, start a session, confirm the
  dock shows the live cost and it updates after a turn.

## Packaging

- The package gains a `dsh.bundle` with a web client entry so dsh loads the
  client half (the mechanism `dsh-plugin-manager` uses).
- Harness packages stay `peerDependencies` + `devDependencies` (per the recent
  fix); the client half additionally needs the `@deepseek-ai/dsh-client-*` peers.

## Open questions to resolve during planning

- Exact `dsh.bundle` client-entry format for a dual host+client plugin.
- Exact `useProjection` signature and `ProjectionValueStore` access from a
  dock slot.
- Client build setup for the package (the repo currently builds host-only with
  plain `tsc`).
