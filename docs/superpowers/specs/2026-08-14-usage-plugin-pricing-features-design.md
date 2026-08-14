# dsh-usage-plugin: pricing features design

Date: 2026-08-14

## Context

`dsh-usage-report` (being renamed to `dsh-usage-plugin`) computes per-session
token usage and estimated cost, and renders the live cost in the web composer
dock. This spec consolidates four changes:

1. **Repo + package rename** to `dsh-usage-plugin` (plugin id stays `usage-report`).
2. **Effective-date-aware pricing**: the fold auto-selects the price regime in
   effect at the current time (old `flat` until the new regime's `effectiveAt`,
   then `peakOffpeak`), so no manual `pricing:` flip is needed when DeepSeek
   raises prices.
3. **DeepSeek price-change detection + dock badge**: the plugin fetches
   DeepSeek's published prices, compares against the local table, and shows a
   dock badge when an update is available (the user updates the table manually).
4. **Unpriced-model notification**: when a session uses a model not in the price
   table, the dock badge and `/usage` surface it and ask the user to add the
   model's price manually.

A broader multi-provider default table was considered and cut: the user has no
API keys for other providers, so it would be untestable end-to-end. Arbitrary
models remain supported via the `prices` config override.

## Architecture

All changes live in the one plugin (`dsh-usage-plugin`), host + client halves.

```
src/                  (host half)
  pricing.ts          price table model + effective-date selection + table diff
  usage-fold.ts       fold: attribute usage, price via the in-effect regime,
                      collect unpriced models
  price-check.ts      NEW: fetch + parse DeepSeek pricing, diff vs local table
  index.ts            projection unit, /usage command (+ check-prices, unpriced
                      list), usage_report tool
  types.ts            UsageReportValue gains priceUpdateAvailable + unpricedModels
src/client/           (client half)
  CostMeter.tsx       renders cost + badges (price update, unpriced model)
```

## 1. Repo + package rename

- GitHub repo `Yihong89/dsh-plugins` → `Yihong89/dsh-usage-plugin` (`gh repo rename`).
- Package name `dsh-usage-report` → `dsh-usage-plugin` in `package.json`,
  `src/client/index.ts` (`name` + `__ModuleLoader__` id), README, and any
  internal references.
- Plugin id stays `usage-report`: the bundle row in `cordis.patch.yml` and the
  profile config keep working unchanged.
- Install path becomes `github:Yihong89/dsh-usage-plugin#main&path:packages/usage-report`.
- The local repo directory may stay `dsh-plugins` or be renamed — either is fine;
  the repo path in profile installs is the only outward-facing change.

## 2. Effective-date-aware pricing

Extend the price model so a regime can carry an `effectiveAt` timestamp:

```ts
interface PeakOffpeakPricing { peak: ModelPrice; offPeak: ModelPrice; peakWindowsUtc: ... }
// NEW: an effectiveAt on the regime entry
interface ModelPricing { flat: ModelPrice; peakOffpeak?: PeakOffpeakPricing & { effectiveAt: string } }
```

- `flat` has no `effectiveAt` (baseline).
- `peakOffpeak.effectiveAt` = `2026-08-16T16:00:00Z` (the raise).
- The fold's pricing step selects the regime whose `effectiveAt` is the latest
  `<= now`; before the boundary → `flat`, at/after → `peakOffpeak`.

## 3. DeepSeek price-change detection

- `checkPrices()` fetches DeepSeek's pricing source (the HTML page at
  `https://api-docs.deepseek.com/quick_start/pricing`, or a machine-readable
  source if one exists), parses the flat/peak/off-peak rates for
  `deepseek-v4-flash` and `deepseek-v4-pro`, and diffs against the local table.
- Runs **once on plugin boot** (async, non-blocking) and on `/usage
  check-prices`.
- On fetch/parse failure: stay on the current table, no notification, no error
  surfaced (graceful).
- On a detected diff: store `priceUpdateAvailable: true` + the old→new diff
  host-side, and surface it in the projection.

## 4. Unpriced-model notification

- The fold records any model id (from `request/header`) that has no entry in the
  price table into `unpricedModels` on the projection value.
- `UsageReportValue` gains:
  - `priceUpdateAvailable: boolean`
  - `unpricedModels: string[]`
- `/usage` prints these (e.g. "⚠ model 'claude-sonnet-5' isn't priced — add it
  under `prices` in cordis.patch.yml").
- The client `CostMeter` shows an amber badge when either flag is set, with the
  detail on hover.

## Data flow

```
host fold → UsageReportValue { totals, models, priceUpdateAvailable, unpricedModels }
   ↓ push model (ProjectionValueStore)
client useProjection('usageReport') → CostMeter re-renders cost + badges
```

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `pricing` | `'flat'` | overrides automatic effective-date selection when set explicitly |
| `prices` | `{}` | per-model overrides (unchanged; the manual update target) |
| `priceCheckUrl` | DeepSeek page | source for the price check |
| `thresholdLow` / `thresholdHigh` | 1.0 / 5.0 | cost color bands (existing) |

## Error handling

- Fetch/parse failure → silent, stay on current table.
- Regime with no `effectiveAt` → baseline (always applies until overridden).
- Unknown model → `$0` cost, listed in `unpricedModels`, never throws.

## Testing

- Effective-date selection: unit tests before/at/after the boundary.
- Price diff: unit tests with fixture HTML/JSON → changed/unchanged/unparseable.
- Unpriced model: fold unit test → unpricedModels populated; CostMeter badge test.
- Rename: full build + existing 11 host + 10 client tests stay green; reinstall
  into the profile and verify boot.
- Boot smoke: with a stale local table, the dock shows the price-update badge.

## Open items for planning

- Machine-readable DeepSeek pricing source (HTML parsing is the fragile part;
  check for a JSON endpoint first).
- Exact published prices for the current DeepSeek models to seed the fixtures.
