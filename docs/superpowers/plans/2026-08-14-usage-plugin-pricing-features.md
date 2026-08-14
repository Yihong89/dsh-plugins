# dsh-usage-plugin: Pricing Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the plugin to `dsh-usage-plugin`, make pricing effective-date-aware, detect DeepSeek price changes with a dock badge, and notify when a used model is unpriced.

**Architecture:** All changes in the one plugin. Host: `pricing.ts` gains effective-date regime selection + a `price-check.ts` fetch/diff module; `usage-fold.ts` collects unpriced models; `types.ts` extends `UsageReportValue` with `priceUpdateAvailable` + `unpricedModels`; `index.ts` wires `/usage check-prices` + boot check. Client: `CostMeter` renders badges from the new projection fields.

**Tech Stack:** TypeScript (strict, ESM), React 18, tsdown, vitest + @testing-library/react, node `fetch` (host price check).

## Global Constraints

- `@deepseek-ai/*` + `@deepseek-ai/cordis` stay **peerDependencies** only.
- Plugin **id stays `usage-report`** (bundle row + profile config unchanged).
- Price source: `https://api-docs.deepseek.com/quick_start/pricing` (Docusaurus SSR HTML, 200 OK, no auth). No public JSON endpoint.
- Published rates (verified against the live page 2026-08-14):
  - flat/old: flash `0.14 / 0.0028 / 0.28`, pro `0.435 / 0.003625 / 0.87`
  - new peak: flash `0.44 / 0.014 / 1.32`, pro `1.32 / 0.044 / 3.96`; off-peak = half
  - new regime `effectiveAt` = `2026-08-16T16:00:00Z` (page states it verbatim)
- Files end with exactly one trailing newline.

---
### Task 1: Repo + package rename to `dsh-usage-plugin`

**Files:**
- Modify: `packages/usage-report/package.json` (name)
- Modify: `packages/usage-report/src/client/index.ts` (name + module id)
- Modify: `packages/usage-report/tsdown.client.config.ts` (loader id)
- Modify: `packages/usage-report/README.md`, root `README.md` (name references)
- Repo: `gh repo rename dsh-usage-plugin` (run last)

**Interfaces:**
- Produces: package `name = "dsh-usage-plugin"`; loader registers `id = "dsh-usage-plugin"`; plugin `name = "dsh-usage-plugin/client"`. Plugin id `usage-report` unchanged.

- [ ] **Step 1: Rename the package name**

In `packages/usage-report/package.json` set `"name": "dsh-usage-plugin"` (keep everything else).

- [ ] **Step 2: Rename the client loader id**

`src/client/index.ts`: `export const name = 'dsh-usage-plugin/client'`.
`tsdown.client.config.ts`: `const id = 'dsh-usage-plugin'`.

- [ ] **Step 3: Update README name references**

`packages/usage-report/README.md` + root `README.md`: `dsh-usage-report` → `dsh-usage-plugin`.

- [ ] **Step 4: Rebuild + full test**

Run: `cd dsh-plugins && CI=true pnpm run build && CI=true pnpm run test`
Expected: build passes; 11 host + 10 client tests pass.

- [ ] **Step 5: Rename the GitHub repo**

Run: `gh repo rename dsh-usage-plugin --repo Yihong89/dsh-plugins --yes`
Expected: repo now `github.com/Yihong89/dsh-usage-plugin` (redirects from the old name).

- [ ] **Step 6: Commit**

```bash
git add packages/usage-report README.md
git commit -m "chore: rename package to dsh-usage-plugin"
git push origin main
```

---
### Task 2: Effective-date-aware pricing

**Files:**
- Modify: `packages/usage-report/src/pricing.ts`
- Modify: `packages/usage-report/src/usage-fold.ts`
- Modify: `packages/usage-report/tests/usage-fold.test.mjs` (add boundary tests)

**Interfaces:**
- Consumes: `ModelPricing` from Task 2.
- Produces: `resolveRegimeFor(pricing: ModelPricing, now: Date): ModelPrice | null` — returns `flat`, or `peakOffpeak` when `effectiveAt <= now`; `null` when nothing is applicable. `effectiveAt` on `peakOffpeak`.

- [ ] **Step 1: Add `effectiveAt` to the regime model**

`pricing.ts`:
```ts
/** Peak/off-peak regime plus the UTC instant it becomes the in-effect rate. */
export interface PeakOffpeakPricing {
  peak: ModelPrice
  offPeak: ModelPrice
  peakWindowsUtc: [startMinutes: number, endMinutes: number][]
  /** ISO-8601 UTC instant at which this regime takes effect (e.g. 2026-08-16T16:00:00Z). */
  effectiveAt: string
}
```
Add `effectiveAt: '2026-08-16T16:00:00Z'` to both models' `peakOffpeak` in `DEEPSEEK_PRICES`.

- [ ] **Step 2: Write the failing boundary tests**

In `tests/usage-fold.test.mjs` add (imports: `resolveRegimeFor`, `DEEPSEEK_PRICES`):
```js
test('flat applies before the peakOffpeak effectiveAt', () => {
  const before = new Date('2026-08-16T15:59:59Z')
  const regime = resolveRegimeFor(DEEPSEEK_PRICES['deepseek-v4-flash'], before)
  assert.equal(regime.inputPerMillion, 0.14)
  assert.equal(regime.outputPerMillion, 0.28)
})

test('peakOffpeak applies at/after the effectiveAt', () => {
  const after = new Date('2026-08-16T16:00:00Z')
  const regime = resolveRegimeFor(DEEPSEEK_PRICES['deepseek-v4-flash'], after)
  // Peak window rates are the peakOffpeak.peak rates; the fold adds window logic.
  assert.ok(regime.inputPerMillion !== 0.14)
})
```
Run and confirm it fails (`resolveRegimeFor` undefined).

- [ ] **Step 3: Implement `resolveRegimeFor`**

`pricing.ts`:
```ts
/** Pick the regime in effect at `now`: `flat` baseline, or `peakOffpeak` once its effectiveAt has passed. */
export function resolveRegimeFor(pricing: ModelPricing, now: Date): ModelPrice | null {
  const regime = pricing.peakOffpeak
  if (regime !== undefined && now.getTime() >= Date.parse(regime.effectiveAt)) {
    return regime.peak
  }
  return pricing.flat
}
```

- [ ] **Step 4: Fold uses `resolveRegimeFor`**

`usage-fold.ts`: replace the direct `pricing[mode]` selection with `resolveRegimeFor(modelPricing, new Date())` when the config is `'auto'`; keep `'flat'`/`'peak-offpeak'` as explicit overrides. Wire the current time through `FoldOptions` as a `now?: () => Date` (default `() => new Date()`) so tests can pin it.

- [ ] **Step 5: Run tests**

Run: `node --test tests/usage-fold.test.mjs`
Expected: existing 11 + 2 new boundary tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/usage-report/src/pricing.ts packages/usage-report/src/usage-fold.ts packages/usage-report/tests/usage-fold.test.mjs
git commit -m "feat: effective-date-aware price regime selection"
```

---
### Task 3: DeepSeek price-change detection (`/usage check-prices`)

**Files:**
- Create: `packages/usage-report/src/price-check.ts`
- Modify: `packages/usage-report/src/index.ts`
- Create: `packages/usage-report/tests/price-check.test.mjs` (+ fixture HTML)

**Interfaces:**
- Produces: `fetchDeepseekPrices(url: string): Promise<ParsedPrices | undefined>` and `diffPrices(local: PriceTable, parsed: ParsedPrices): string[]` (diff lines). `ParsedPrices` shape:
```ts
interface ParsedPrices { flat: { flash: ModelPrice; pro: ModelPrice }; peakOffpeak: { flash: PeakOffpeakPricing; pro: PeakOffpeakPricing } }
```

- [ ] **Step 1: Write the failing diff test**

`tests/price-check.test.mjs` imports `diffPrices` with an equal table → `[]`, and a changed table → the changed lines. Run → fails (module missing).

- [ ] **Step 2: Implement `diffPrices`**

`price-check.ts`:
```ts
export function diffPrices(local: PriceTable, parsed: ParsedPrices): string[] {
  const out: string[] = []
  const models = { flash: 'deepseek-v4-flash', pro: 'deepseek-v4-pro' } as const
  for (const [key, model] of Object.entries(models)) {
    const localFlat = local[model]?.flat
    const want = parsed.flat[key as 'flash' | 'pro']
    if (localFlat === undefined || localFlat.inputPerMillion !== want.inputPerMillion
      || localFlat.cacheReadPerMillion !== want.cacheReadPerMillion
      || localFlat.outputPerMillion !== want.outputPerMillion) {
      out.push(`${model} flat: local ${JSON.stringify(localFlat)} vs published ${JSON.stringify(want)}`)
    }
  }
  return out
}
```

- [ ] **Step 3: Implement `fetchDeepseekPrices` (HTML → prices)**

`price-check.ts`: `fetch` the URL, strip tags to text, then regex-extract:
```ts
const FLAT_RE = /1M INPUT TOKENS \(CACHE HIT\) \$(\S+) \$(\S+)[\s\S]*?1M INPUT TOKENS \(CACHE MISS\) \$(\S+) \$(\S+)[\s\S]*?1M OUTPUT TOKENS \$(\S+) \$(\S+)/
const PEAK_RE = /deepseek-v4-flash OFF-PEAK \$(\S+) \$(\S+) \$(\S+) PEAK \$(\S+) \$(\S+) \$(\S+)[\s\S]*?deepseek-v4-pro OFF-PEAK \$(\S+) \$(\S+) \$(\S+) PEAK \$(\S+) \$(\S+) \$(\S+)/
```
Order: flash then pro in `FLAT_RE`; parse each `$` value with `parseFloat`. Return `ParsedPrices` or `undefined` on any mismatch. Tag-strip: `html.replace(/<[^>]+>/g, ' ')` then collapse whitespace.

- [ ] **Step 4: Wire `/usage check-prices` + boot check into `index.ts`**

Add a `check-prices` subcommand to the `/usage` command handler: `fetchDeepseekPrices(config.priceCheckUrl)` → `diffPrices(prices, parsed)`; if non-empty, print the diff and set `priceUpdateAvailable = true`; on `undefined` print "could not verify". Run the same check once on boot (fire-and-forget, `void`), storing `priceUpdateAvailable`/diff in a host-scoped holder the projection unit reads.

- [ ] **Step 5: Run tests + typecheck**

Run: `node --test tests/price-check.test.mjs` and `npx tsc -p tsconfig.host.json --noEmit`. Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/usage-report/src/price-check.ts packages/usage-report/src/index.ts packages/usage-report/tests/price-check.test.mjs
git commit -m "feat: DeepSeek price-change detection + /usage check-prices"
```

---
### Task 4: Unpriced-model tracking + projection fields

**Files:**
- Modify: `packages/usage-report/src/types.ts`
- Modify: `packages/usage-report/src/usage-fold.ts`
- Modify: `packages/usage-report/src/index.ts`
- Modify: `packages/usage-report/tests/usage-fold.test.mjs`

**Interfaces:**
- Produces: `UsageReportValue` gains `priceUpdateAvailable: boolean` and `unpricedModels: string[]`.

- [ ] **Step 1: Extend the value type**

`types.ts`:
```ts
export interface UsageReportValue {
  totals: ModelUsage
  models: Record<string, ModelUsage>
  /** A DeepSeek price change was detected and the local table is stale. */
  priceUpdateAvailable: boolean
  /** Models used this session with no entry in the price table. */
  unpricedModels: string[]
}
```
Update `emptyUsageReport()` and `viewUsage` to seed `priceUpdateAvailable: false` / `unpricedModels: []`.

- [ ] **Step 2: Collect unpriced models in the fold**

`usage-fold.ts`: when attributing a usage sample to a model, if `resolveRegimeFor(modelPricing, now) === null` (or the model id is absent from the price table), add the model id to the state's `unpricedModels` set (dedup, insertion order).

- [ ] **Step 3: Write the failing test**

In `usage-fold.test.mjs`: feed a `request/header` with model `'some-unknown-model'` + a usage sample; assert the view's `unpricedModels` contains it and its cost is 0.

- [ ] **Step 4: Surface in `/usage`**

`index.ts` `/usage` handler: after the report text, if `priceUpdateAvailable` print a line `⚠ DeepSeek prices changed on api-docs.deepseek.com — update the `prices` table in cordis.patch.yml (see /usage check-prices)`; if `unpricedModels.length > 0` print `⚠ unpriced models: <list> — add them under `prices``.

- [ ] **Step 5: Run tests**

Run: `node --test tests/usage-fold.test.mjs`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/usage-report/src/types.ts packages/usage-report/src/usage-fold.ts packages/usage-report/src/index.ts packages/usage-report/tests/usage-fold.test.mjs
git commit -m "feat: track unpriced models + price-update flag"
```

---
### Task 5: Client badges (price update + unpriced model)

**Files:**
- Modify: `packages/usage-report/src/client/CostMeter.tsx`
- Modify: `packages/usage-report/tests/CostMeter.test.tsx`

**Interfaces:**
- Consumes: `UsageReportValue` with the new fields.

- [ ] **Step 1: Write the failing badge tests**

`tests/CostMeter.test.tsx`:
- `renderWith({ totals: { cost: 0.42 }, priceUpdateAvailable: true, unpricedModels: [] })` → `usage-cost` also contains a badge element with `data-badge="price-update"`.
- `renderWith({ totals: { cost: 0.42 }, priceUpdateAvailable: false, unpricedModels: ['foo'] })` → badge `data-badge="unpriced"` with title naming `foo`.
Run → fails.

- [ ] **Step 2: Render badges in CostMeter**

`CostMeter.tsx`: when `value.priceUpdateAvailable`, append `<span data-testid="price-badge" data-badge="price-update" title="DeepSeek prices changed — update the prices table in cordis.patch.yml">⚠</span>`; when `value.unpricedModels.length > 0`, append a similar `unpriced` badge whose title lists the models. Keep the existing cost text + band.

- [ ] **Step 3: Run tests**

Run: `cd packages/usage-report && npx vitest run`. Expected: all pass.

- [ ] **Step 4: Rebuild + full test**

Run: `CI=true pnpm run build && CI=true pnpm run test`. Expected: green (11 host + 12 client).

- [ ] **Step 5: Commit**

```bash
git add packages/usage-report/src/client/CostMeter.tsx packages/usage-report/tests/CostMeter.test.tsx
git commit -m "feat: dock badges for price update + unpriced models"
```

---
### Task 6: Reinstall into dsh and verify end-to-end

**Files:** none (deployment).

- [ ] **Step 1: Push + reinstall under the new repo path**

```sh
git push origin main
dsh plugin --profile web remove usage-report 2>&1   # remove old install (id-based)
dsh plugin --profile web add -w 'github:Yihong89/dsh-usage-plugin#main&path:packages/usage-report'
```

- [ ] **Step 2: Restart + boot check**

Restart `dsh web` (surgical PID kill as before). Expected: clean boot; `/usage check-prices` runs on boot and, since the local table already matches the live page, prints "prices up to date".

- [ ] **Step 3: Verify the badge surfaces**

Temporarily set a wrong price in `cordis.patch.yml` (e.g. change `deepseek-v4-flash.flat.inputPerMillion` to `9.99`), restart, open a session, confirm the dock shows the `price-update` badge; revert the config and confirm it clears.

- [ ] **Step 4: Verify the unpriced-model badge**

Set `prices` to only cover one model, run a session turn, confirm `/usage` lists the other model as unpriced and the dock shows the `unpriced` badge.

- [ ] **Step 5: Update the README**

Document `/usage check-prices`, the auto effective-date, and the two badge meanings. Commit.

---
## Self-Review Notes

- **Spec coverage:** rename (T1), effective-date (T2), price-check + `/usage check-prices` (T3), unpriced-model + projection fields (T4), dock badges (T5), reinstall/verify (T6). Broader multi-provider table deliberately absent (cut in spec).
- **Type consistency:** `resolveRegimeFor`, `fetchDeepseekPrices`, `diffPrices`, `priceUpdateAvailable`, `unpricedModels` used identically across tasks.
- **Effective-date detail:** the fold switches `'auto'` mode (default) via `resolveRegimeFor`; explicit `'flat'`/`'peak-offpeak'` config still overrides (kept for users who want to pin).
