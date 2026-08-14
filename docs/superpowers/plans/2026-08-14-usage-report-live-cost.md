# dsh-usage-report: Live Cost in Composer Dock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the current session's estimated cost live in the dsh web composer dock, color-coded, without running `/usage`.

**Architecture:** Make `dsh-usage-report` a dual-plane plugin. Keep the host half (projection + `/usage` + `usage_report`) unchanged; add a client half that registers a `CostMeter` component into the `conversation.composer.dock` slot. The component reads the host's `usageReport` session projection via the framework's `useProjection` hook (push model) and renders the color-coded cost.

**Tech Stack:** TypeScript (strict, ESM), React 18, tsdown (host + client bundles), vitest + @testing-library/react (client tests). Pattern reference: `dsh-plugin-manager` (dual-plane bundle) and `ui-jobs` (client plugin registration).

## Global Constraints

- `@deepseek-ai/*` and `@deepseek-ai/cordis` are **peerDependencies** only — never regular `dependencies` (resolved from the harness). Pure libs (`schemastery`, `zod`) stay in `dependencies`.
- The `usageReport` projection key and `SessionProjectionMap` augmentation already live in `src/types.ts` — do not duplicate them.
- The client half must not import host-side value modules (`src/index.ts` pulls `Context.sessions`, `dsh-tools`, etc.). Keep it to `types.js`, `pricing.js` types, and the client packages.
- Files end with exactly one trailing newline.
- Host build emits `lib/index.js`; client build emits `lib/client.js`; types to `lib/types/**`.

---
### Task 1: Add the dual-plane build infrastructure

**Files:**
- Modify: `packages/usage-report/package.json`
- Create: `packages/usage-report/tsconfig.base.json`, `tsconfig.host.json`, `tsconfig.client.json`
- Create: `packages/usage-report/tsdown.host.config.ts`, `tsdown.client.config.ts`
- Modify: `dsh-plugins/pnpm-workspace.yaml` (add `minimumReleaseAgeExclude` entries as pnpm requests them)

**Interfaces:**
- Produces: `pnpm run build` emits `lib/index.js` (host), `lib/client.js` (client), `lib/types/**/*.d.ts`. `package.json` gains `dsh.bundle` + `dsh.client` and an `exports["./client"]`.

- [ ] **Step 1: Add dev dependencies + client peer dependencies**

In `packages/usage-report/package.json`, extend:
```jsonc
"dependencies": {
  "@deepseek-ai/schemastery": "^3.18.1",
  "zod": "^4.4.3"
},
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.0.1",
  "@deepseek-ai/dsh-commands": "^0.1.0-rc.6",
  "@deepseek-ai/dsh-session": "^0.1.0-rc.6",
  "@deepseek-ai/dsh-session-projection": "^0.1.0-rc.6",
  "@deepseek-ai/dsh-tools": "^0.1.0-rc.6",
  "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.6",
  "@deepseek-ai/dsh-client-ui-slots": "^0.1.0-rc.6",
  "@deepseek-ai/dsh-client-ui-conversation": "^0.1.0-rc.6",
  "react": "^18.2.0"
},
"devDependencies": {
  // all peer packages above, plus:
  "tsdown": "^0.22.14",
  "lightningcss": "^1.30.2",
  "vitest": "^4.1.0",
  "@testing-library/react": "^16.3.0",
  "@testing-library/jest-dom": "^6.0.0",
  "jsdom": "^29.0.0",
  "react-dom": "^18.3.1",
  "@types/react": "^18.3.28",
  "@types/react-dom": "^18.3.7"
}
```

- [ ] **Step 2: Create the three tsconfigs**

`tsconfig.base.json` (verbatim from the dsh-plugin-manager pattern):
```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2024"],
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": false,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "lib/types",
    "types": ["node"]
  }
}
```

`tsconfig.host.json`:
```json
{
  "extends": "./tsconfig.base.json",
  "include": ["src/index.ts", "src/types.ts", "src/usage-fold.ts", "src/pricing.ts", "src/format.ts"]
}
```

`tsconfig.client.json`:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "types": [],
    "noEmit": false
  },
  "include": ["src/types.ts", "src/client/**/*.ts", "src/client/**/*.tsx"]
}
```

- [ ] **Step 3: Create the tsdown configs**

`tsdown.host.config.ts`:
```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  clean: false,
  dts: false,
})
```

`tsdown.client.config.ts` (externals per the reference — no CSS plugin needed unless you add `.module.css`):
```ts
import { defineConfig } from 'tsdown'

const externals = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-slots',
  'react',
  'react/jsx-runtime',
]

export default defineConfig({
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  clean: false,
  dts: false,
  sourcemap: true,
  deps: {
    neverBundle: externals,
    alwaysBundle: [/.*/],
  },
})
```

- [ ] **Step 4: Update package.json — dsh field, scripts, files, exports**

```jsonc
"scripts": {
  "clean": "rm -rf lib",
  "build": "pnpm run clean && tsc -p tsconfig.host.json && tsdown --config tsdown.host.config.ts && tsc -p tsconfig.client.json && tsdown --config tsdown.client.config.ts",
  "test": "node --test tests/usage-fold.test.mjs && vitest run",
  "typecheck": "tsc -p tsconfig.host.json --noEmit && tsc -p tsconfig.client.json --noEmit"
},
"files": [
  "lib/index.js",
  "lib/client.js",
  "lib/client.js.map",
  "lib/types/**/*.js",
  "lib/types/**/*.d.ts",
  "README.md"
],
"exports": {
  ".": { "types": "./lib/types/index.d.ts", "import": "./lib/index.js" },
  "./types": { "types": "./lib/types/types.d.ts", "import": "./lib/types/types.js" },
  "./client": { "types": "./lib/types/client/index.d.ts", "import": "./lib/client.js" },
  "./package.json": "./package.json"
},
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-locale"]
  }
}
```

Create `packages/usage-report/cordis.patch.yml`:
```yaml
- id: usage-report
  name: 'dsh-usage-report'
```

- [ ] **Step 5: Install, build, verify host intact**

Run: `cd dsh-plugins && CI=true pnpm install && CI=true pnpm run build`
Expected: `lib/index.js` + `lib/types/**` emitted; no type errors. Run `CI=true pnpm run test` → 11 host tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/usage-report/package.json packages/usage-report/tsconfig*.json packages/usage-report/tsdown*.config.ts packages/usage-report/cordis.patch.yml dsh-plugins/pnpm-workspace.yaml
git commit -m "build: dual host/client build for usage-report"
```

---
### Task 2: Client half — CostMeter + dock registration

**Files:**
- Create: `packages/usage-report/src/client/index.ts`
- Create: `packages/usage-report/src/client/CostMeter.tsx`
- Create: `packages/usage-report/src/client/color.ts`

**Interfaces:**
- Consumes: `useProjection` from the session standard kit (`SessionStandardProps`), delivered automatically to session-scope slot components.
- Produces: `src/client/index.ts` exports `name` / `inject` / `apply(ctx: ClientContext)`. `CostMeter` is the registered component.

- [ ] **Step 1: Write the color helper (with a test first in Task 3)**

`src/client/color.ts`:
```ts
/** Color thresholds for the live cost readout (USD). */
export const LOW_COST_THRESHOLD = 1.0
export const HIGH_COST_THRESHOLD = 5.0

/** 'low' | 'mid' | 'high' band for a cost in USD. */
export function costBand(cost: number): 'low' | 'mid' | 'high' {
  if (cost < LOW_COST_THRESHOLD) return 'low'
  if (cost >= HIGH_COST_THRESHOLD) return 'high'
  return 'mid'
}
```

- [ ] **Step 2: Write the CostMeter component**

`src/client/CostMeter.tsx`:
```tsx
// Type-only: pulls the 'conversation.composer.dock' SlotMap entry, and the
// runtime merges the session standard kit (which includes `useProjection`)
// into PropsRuntime for session-scope slots — so `useProjection` arrives as a
// prop; we only consume it.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import { costBand, LOW_COST_THRESHOLD, HIGH_COST_THRESHOLD } from './color.ts'
import type { UsageReportValue } from '../types.js'

/** Props for the dock entry — session standard kit already carries useProjection. */
export type CostMeterProps = PropsRuntime<'conversation.composer.dock'>

/** Format a USD cost to a compact string, e.g. $1.25 (2 decimals for display). */
export function formatCost(cost: number, decimals = 2): string {
  return `$${cost.toFixed(decimals)}`
}

/** Render the current session's estimated cost, color-coded by magnitude. */
export function CostMeter({ useProjection }: CostMeterProps): JSX.Element | null {
  // Typed via the SessionProjectionMap augmentation in src/types.ts.
  const value = useProjection('usageReport') as UsageReportValue | undefined
  if (value === undefined) return null
  const cost = value.totals.cost
  const band = costBand(cost)
  return (
    <span data-testid="usage-cost" data-band={band} title={`est. cost · threshold <$${LOW_COST_THRESHOLD} low, >=$${HIGH_COST_THRESHOLD} high`}>
      {formatCost(cost)}
    </span>
  )
}
```

- [ ] **Step 3: Write the client plugin entry**

`src/client/index.ts`:
```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CostMeter } from './CostMeter.tsx'

export const name = 'dsh-usage-report/client'
export const inject = ['sessions', 'slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'usage-cost',
    // After the built-in stats line (order 0).
    order: 5,
  }, CostMeter))
}
```

- [ ] **Step 4: Typecheck + build the client half**

Run: `cd dsh-plugins && pnpm --filter dsh-usage-report exec tsc -p tsconfig.client.json --noEmit`
Expected: no type errors. If `useProjection<'usageReport'>` fails to resolve the key, confirm `src/types.ts` is included by `tsconfig.client.json` (it is, via `"include": ["src/types.ts", ...]`) — the augmentation flows through the program.

- [ ] **Step 5: Commit**

```bash
git add packages/usage-report/src/client
git commit -m "feat: live cost readout in the composer dock"
```

---
### Task 3: Client tests (vitest)

**Files:**
- Create: `packages/usage-report/tests/CostMeter.test.tsx`
- Create: `packages/usage-report/vitest.config.ts`

**Interfaces:**
- Consumes: `CostMeter`, `formatCost`, `costBand` from Task 2.

- [ ] **Step 1: Write the failing tests**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx'],
  },
})
```

`tests/CostMeter.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { CostMeter, formatCost } from '../src/client/CostMeter.tsx'
import { costBand } from '../src/client/color.ts'

function renderWith(value: { totals: { cost: number } } | undefined) {
  return render(<CostMeter useProjection={() => value} /> as any)
}

describe('costBand', () => {
  it('bands below the low threshold as low', () => expect(costBand(0.4)).toBe('low'))
  it('bands at the low threshold as mid', () => expect(costBand(1.0)).toBe('mid'))
  it('bands mid-range as mid', () => expect(costBand(2.5)).toBe('mid'))
  it('bands at/above the high threshold as high', () => expect(costBand(5.0)).toBe('high'))
})

describe('formatCost', () => {
  it('formats to two decimals with a dollar sign', () => expect(formatCost(1.25)).toBe('$1.25'))
})

describe('CostMeter', () => {
  it('renders nothing when there is no projection', () => {
    const { container } = renderWith(undefined)
    expect(container).toBeEmptyDOMElement()
  })
  it('renders the cost with the low band class', () => {
    const { getByTestId } = renderWith({ totals: { cost: 0.42 } })
    expect(getByTestId('usage-cost')).toHaveAttribute('data-band', 'low')
    expect(getByTestId('usage-cost')).toHaveTextContent('$0.42')
  })
  it('renders the cost with the high band class', () => {
    const { getByTestId } = renderWith({ totals: { cost: 8.0 } })
    expect(getByTestId('usage-cost')).toHaveAttribute('data-band', 'high')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dsh-plugins/packages/usage-report && npx vitest run`
Expected: FAIL — `src/client/CostMeter.tsx` etc. do not exist yet (module not found).

- [ ] **Step 3: Implement the modules (Task 2 files) so the tests pass**

Run: `npx vitest run`
Expected: PASS — all 7 client tests.

- [ ] **Step 4: Run the full suite**

Run: `cd dsh-plugins && CI=true pnpm run build && CI=true pnpm run test`
Expected: build passes; 11 host tests + 7 client tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/usage-report/vitest.config.ts packages/usage-report/tests/CostMeter.test.tsx
git commit -m "test: live cost readout unit tests"
```

---
### Task 4: Real-composition verification in dsh

**Files:** none (deployment). Uses `dsh-plugin-manager` bundle-activation path.

**Interfaces:**
- Consumes: the built package with `dsh.bundle` + `dsh.client`.

- [ ] **Step 1: Publish the fix + feature to GitHub (or install from local path)**

Run: `cd dsh-plugins && git push origin main`
Then install the git path (mirrors the documented install):
```sh
dsh plugin --profile web add -w 'github:Yihong89/dsh-plugins#main&path:packages/usage-report'
```
> Note: this activates the bundle (`dsh.bundle`), which includes the client entry — no separate patch row is needed beyond the bundle's own `cordis.patch.yml`.

- [ ] **Step 2: Restart dsh web and verify the client loads**

```sh
pkill -f "/usr/local/bin/dsh web"; cd ~ && nohup dsh web > /tmp/dsh-web-usage.log 2>&1 &
```
Expected: clean boot; the web app's `__DSH_BOOT__` includes the `dsh-usage-report` client entry.

- [ ] **Step 3: Verify the dock shows live cost**

In the web UI, open a session and run one turn (so `usageReport` projection pushes a value). Confirm:
- The composer dock shows a `$…` readout.
- It re-renders (cost increases) after a second turn.
- `/usage` still works (host half unaffected).
- Tool dispatch still works (no regression — run a `bash` call).

- [ ] **Step 4: Commit any docs/README updates**

Update `packages/usage-report/README.md` with the live-cost feature and the new bundle install path. Commit.

---
## Self-Review Notes

- **Spec coverage:** all spec sections map to tasks — dual-plane architecture (T1), CostMeter + dock registration (T2), color-coding thresholds (T2, constants with documented defaults; runtime configurability deferred to keep client config plumbing out of scope), graceful empty state (T2), client tests + boot smoke (T3/T4), packaging `dsh.bundle`/`dsh.client` (T1).
- **Type consistency:** `costBand`, `formatCost`, `CostMeterProps`, `useProjection` names used identically across T2/T3.
- **Deferred (noted, not dropped):** runtime-configurable thresholds and locale dictionaries — not needed for the core ask.
