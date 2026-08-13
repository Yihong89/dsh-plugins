# dsh-plugins

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

| Package | What it does |
|---|---|
| [`dsh-usage-report`](#dsh-usage-report) | Per-session token usage and estimated cost report (`/usage` command + `usage_report` tool), priced from the DeepSeek pricing table. |

The repository currently holds one package at the repo root (the standard
out-of-tree bundle layout). When a second plugin lands, the root becomes a
pnpm workspace and each plugin moves to `packages/<name>`.

---

# dsh-usage-report

A DeepSeek Harness plugin that reports the current session's **token usage and
estimated cost**. One host-plane plugin row registers:

- the `usageReport` session-projection unit — folds the provider-reported
  usage of every model request (uncached input, cache-read, cache-write,
  output) attributed to the model named by the nearest `request/header`, and
  prices each sample with the configured price table;
- the **`/usage`** human command — prints the report as a table;
- the **`usage_report`** model tool — returns the same report as canonical
  JSON, so the agent itself can check budget mid-task.

Costs are **estimates**, not billing records: they multiply the provider's
reported token buckets by the price table below. The token buckets are exact
provider numbers; the prices are configuration.

## Install

Requirements: a DSH profile with the `tools`, `commands`, and
`sessionProjections` services (the `web` and `headless` profiles provide all
three via `dsh-base`).

```sh
# 1. make the plugin available to your profile (installs from this GitHub repo)
dsh plugin --profile web add -w github:Yihong89/dsh-plugins#main

# 2. activate it in the profile's patch layer
#    add to ~/.dsh/profiles/web/cordis.patch.yml:
#
#    - insert:
#        - id: usage-report
#          name: 'dsh-usage-report'

# 3. restart the profile (e.g. restart the `dsh web` process)
```

The package commits its built `lib/`, so the install needs no build-script
permission. A profile patch is a pnpm workspace root, hence the `-w` flag.

## Usage

### `/usage` (human)

Type `/usage` in a chat. Example output:

```text
Session usage report
model                 uncached-input  cache-read  cache-write  output  requests  est. cost
deepseek-v4-flash              1,234        5,678           12   8,901        14  $0.012345
Total                          1,234        5,678           12   8,901        14  $0.012345
```

### `usage_report` (model tool)

The model can call it mid-task ("how much have we spent?") and receives the
same numbers as canonical JSON:

```json
{
  "totals": { "uncachedInputTokens": 1234, "cacheReadTokens": 5678, "cacheWriteTokens": 12, "outputTokens": 8901, "requests": 14, "cost": 0.012345 },
  "models": [{ "model": "deepseek-v4-flash", "usage": { "...": "..." } }]
}
```

## Configuration

Set from the plugin row's `config:` block in `cordis.patch.yml`:

```yaml
- id: usage-report
  name: 'dsh-usage-report'
  config:
    pricing: flat            # 'flat' | 'peak-offpeak'
    prices: {}               # per-model overrides, merged over the DeepSeek table
    defaultModel: unknown    # model attributed to usage with no request/header yet
    costDecimals: 6          # decimal places for USD in text output
```

| Key | Default | Meaning |
|---|---|---|
| `pricing` | `'flat'` | `'flat'` uses one rate per model; `'peak-offpeak'` varies the rate by UTC hour (DeepSeek's regime effective 2026-08-16). |
| `prices` | `{}` | Per-model overrides merged over the shipped DeepSeek table. A model with no entry counts its tokens but prices at $0 ("unpriced" in the report). |
| `defaultModel` | `'unknown'` | Model bucket for a usage sample that arrives before any `request/header`. |
| `costDecimals` | `6` | Decimal places for USD cost in text output. |

Price entry shape (per model):

```yaml
prices:
  deepseek-v4-flash:
    flat: { inputPerMillion: 0.14, cacheReadPerMillion: 0.0028, outputPerMillion: 0.28 }
    peakOffpeak:
      peak: { inputPerMillion: 0.44, cacheReadPerMillion: 0.014, outputPerMillion: 1.32 }
      offPeak: { inputPerMillion: 0.22, cacheReadPerMillion: 0.007, outputPerMillion: 0.66 }
      peakWindowsUtc: [[60, 240], [360, 600]]   # [start, end) minutes of day, UTC
```

### Shipped DeepSeek prices (USD per 1M tokens)

Flat rates in effect since before 2026-08-16 (source:
[DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing)):

| Model | Input (cache miss) | Input (cache hit) | Output |
|---|---|---|---|
| deepseek-v4-flash | $0.14 | $0.0028 | $0.28 |
| deepseek-v4-pro | $0.435 | $0.003625 | $0.87 |

Peak/off-peak regime effective **16:00 UTC 2026-08-16** (peak hours
01:00–04:00 and 06:00–10:00 UTC, off-peak otherwise):

| Model | Cache hit off-peak / peak | Cache miss off-peak / peak | Output off-peak / peak |
|---|---|---|---|
| deepseek-v4-flash | $0.007 / $0.014 | $0.22 / $0.44 | $0.66 / $1.32 |
| deepseek-v4-pro | $0.022 / $0.044 | $0.66 / $1.32 | $1.98 / $3.96 |

DeepSeek may change prices; restate `prices` from the pricing page when they
do (bump the plugin's `stateVersion` after changing the fold, or the persisted
projection cache may serve stale rows).

## How it works

The plugin registers one `usageReport` projection unit on
`ctx.sessionProjections` (registered only when the seam is composed). The fold
mirrors `dsh-token-meter`'s accounting:

- `request/header` sets the current route; usage samples are attributed to its
  model (or `defaultModel` / `'unknown'`).
- `assistant/chunk` usage chunks and `assistant/message` usage both count, with
  the token-meter rule that a later sample for the same `(turn, step)` replaces
  the earlier one — a chunk superseded by its assembled message never
  double-counts, and `requests` counts each `(turn, step)` once.
- Cost per sample = billed input (uncached + cache-write) × miss rate
  + cache-read × hit rate + output × output rate, with the peak/off-peak rate
  selected by the sample's UTC timestamp when `pricing: peak-offpeak`.

The command and tool read the projection value through `ctx.get` (they work
with an empty report if the seam is absent).

## Known limitations

- **Cost is an estimate, not a billing record.** The token buckets are exact
  provider-reported numbers; the price table is configuration. The harness
  itself contains no price metadata, so the plugin cannot verify DeepSeek's
  current rates.
- **Cache-write is billed at the cache-miss input rate.** The harness reports
  cached input as separate cache-read/cache-write buckets; DeepSeek bills
  cache-hit tokens cheaply and everything else at the input rate.
- **Unpriced models cost $0.** Tokens still count; the report flags the model
  as `unpriced`.
- **Peak/off-peak applies by request timestamp.** The fold stores the request
  time from the usage event; a session spanning a rate change prices each
  request with the regime in effect at its time.
- **Sessions without a provider usage report show zeros.** Some adapters or
  failed requests report no usage; those requests are not counted.

## Development

```sh
pnpm install
pnpm run build    # tsc → lib/
pnpm test         # node --test tests/ (against the built lib)
```

TypeScript `strict` with `exactOptionalPropertyTypes`. The fold and pricing
are pure functions with unit tests; the plugin wiring follows the harness's
function-plugin contract (`name` / `inject` / `Config` / `apply`).
