/**
 * Unit tests for the usage-report fold and pricing. Run against the built
 * lib: `pnpm run build && pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyUsage,
  viewUsage,
  usageReportProjectionWith,
  emptyUsageReport,
} from '../lib/usage-fold.js'
import {
  costOf,
  priceFor,
  inPeakWindow,
  DEEPSEEK_PRICES,
} from '../lib/pricing.js'

const FLASH = DEEPSEEK_PRICES['deepseek-v4-flash']

/** Minimal session event helper: only the fields the fold reads. */
function event(type, seq, time, data) {
  return { type, seq, time, data }
}

const header = (model = 'deepseek-v4-flash', provider = 'deepseek-official') =>
  event('request/header', 1, 1_700_000_000_000, { header: { config: { provider, model } }, reason: 'initial' })

const usageChunk = (seq, turn, step, usage) =>
  event('assistant/chunk', seq, 1_700_000_000_000, { turn, step, chunk: { type: 'usage', usage } })

const usageMessage = (seq, turn, step, usage) =>
  event('assistant/message', seq, 1_700_000_000_000, { turn, step, message: { role: 'assistant', content: [] }, usage })

const buckets = (uncachedInputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0) =>
  ({ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens })

test('flat cost math matches the DeepSeek page (per 1M units)', () => {
  const price = FLASH.flat
  assert.equal(costOf(price, buckets(1_000_000, 1_000_000)), (1_000_000 * 0.14 + 1_000_000 * 0.28) / 1e6)
  assert.equal(costOf(price, buckets(0, 0, 1_000_000)), (1_000_000 * 0.0028) / 1e6)
  assert.equal(costOf(price, buckets(0, 0, 0, 1_000_000)), (1_000_000 * 0.14) / 1e6, 'cache write bills at the cache-miss input rate')
})

test('peak/off-peak selects by UTC hour', () => {
  const pricing = FLASH.peakOffpeak
  // 02:30 UTC — inside the 01:00-04:00 peak window.
  const peakTime = Date.UTC(2026, 7, 13, 2, 30)
  // 12:00 UTC — off-peak.
  const offPeakTime = Date.UTC(2026, 7, 13, 12, 0)
  assert.equal(inPeakWindow(pricing.peakWindowsUtc, 150), true)
  assert.equal(inPeakWindow(pricing.peakWindowsUtc, 720), false)
  assert.equal(priceFor(FLASH, 'peak-offpeak', peakTime), pricing.peak)
  assert.equal(priceFor(FLASH, 'peak-offpeak', offPeakTime), pricing.offPeak)
  assert.equal(priceFor(FLASH, 'flat', peakTime), FLASH.flat)
  assert.equal(costOf(priceFor(FLASH, 'peak-offpeak', peakTime), buckets(1_000_000, 1_000_000)), (1_000_000 * 0.44 + 1_000_000 * 1.32) / 1e6)
  assert.equal(costOf(priceFor(FLASH, 'peak-offpeak', offPeakTime), buckets(1_000_000, 1_000_000)), (1_000_000 * 0.22 + 1_000_000 * 0.66) / 1e6)
})

test('windows that wrap midnight treat both sides as peak', () => {
  assert.equal(inPeakWindow([[23 * 60, 2 * 60]], 23 * 60 + 30), true)
  assert.equal(inPeakWindow([[23 * 60, 2 * 60]], 60), true)
  assert.equal(inPeakWindow([[23 * 60, 2 * 60]], 12 * 60), false)
})

test('fold attributes usage to the model named by the nearest request/header', () => {
  const def = usageReportProjectionWith({ prices: DEEPSEEK_PRICES, mode: 'flat' })
  let state = def.init()
  state = def.apply(state, header('deepseek-v4-flash'))
  state = def.apply(state, usageMessage(2, 1, 1, { inputTokens: 1000, outputTokens: 200 }))
  const value = def.view(state)
  assert.deepEqual(value.models['deepseek-v4-flash'], {
    uncachedInputTokens: 1000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 200,
    requests: 1,
    cost: (1000 * 0.14 + 200 * 0.28) / 1e6,
  })
  assert.equal(value.totals.requests, 1)
  assert.equal(value.totals.cost, value.models['deepseek-v4-flash'].cost)
})

test('a usage chunk superseded by the assembled message replaces, not doubles', () => {
  const def = usageReportProjectionWith({ prices: DEEPSEEK_PRICES, mode: 'flat' })
  let state = def.init()
  state = def.apply(state, header('deepseek-v4-flash'))
  state = def.apply(state, usageChunk(2, 1, 1, { inputTokens: 1000, outputTokens: 50 }))
  state = def.apply(state, usageMessage(3, 1, 1, { inputTokens: 1000, outputTokens: 200 }))
  const value = def.view(state)
  assert.equal(value.models['deepseek-v4-flash'].outputTokens, 200)
  assert.equal(value.models['deepseek-v4-flash'].requests, 1)
})

test('cache-read and cache-write buckets are priced separately', () => {
  const def = usageReportProjectionWith({ prices: DEEPSEEK_PRICES, mode: 'flat' })
  let state = def.init()
  state = def.apply(state, header('deepseek-v4-flash'))
  state = def.apply(state, usageMessage(2, 1, 1, {
    inputTokens: 900,
    outputTokens: 100,
    cacheReadTokens: 100,
    cacheWriteTokens: 50,
  }))
  const value = def.view(state)
  assert.equal(value.totals.cacheReadTokens, 100)
  assert.equal(value.totals.cacheWriteTokens, 50)
  const expected = (950 * 0.14 + 100 * 0.0028 + 100 * 0.28) / 1e6
  assert.equal(value.totals.cost, expected)
})

test('a model change mid-session splits usage into two model rows', () => {
  const def = usageReportProjectionWith({ prices: DEEPSEEK_PRICES, mode: 'flat' })
  let state = def.init()
  state = def.apply(state, header('deepseek-v4-flash'))
  state = def.apply(state, usageMessage(2, 1, 1, { inputTokens: 100, outputTokens: 10 }))
  state = def.apply(state, header('deepseek-v4-pro'))
  state = def.apply(state, usageMessage(4, 2, 1, { inputTokens: 200, outputTokens: 20 }))
  const value = def.view(state)
  assert.deepEqual(Object.keys(value.models).sort(), ['deepseek-v4-flash', 'deepseek-v4-pro'])
  assert.equal(value.totals.requests, 2)
  assert.equal(value.totals.uncachedInputTokens, 300)
})

test('unpriced and unknown models count tokens with zero cost', () => {
  const def = usageReportProjectionWith({ prices: DEEPSEEK_PRICES, mode: 'flat' })
  let state = def.init()
  // No request/header yet: attributed to the defaultModel/unknown bucket.
  state = def.apply(state, usageMessage(1, 1, 1, { inputTokens: 500, outputTokens: 50 }))
  const value = def.view(state)
  assert.equal(value.models['unknown'].uncachedInputTokens, 500)
  assert.equal(value.models['unknown'].cost, 0)
  assert.equal(value.totals.uncachedInputTokens, 500)
  assert.equal(value.totals.cost, 0)
})

test('peak-offpeak mode prices by the sample timestamp', () => {
  const def = usageReportProjectionWith({ prices: DEEPSEEK_PRICES, mode: 'peak-offpeak' })
  let state = def.init()
  state = def.apply(state, header('deepseek-v4-flash'))
  // 02:30 UTC — peak. The event time drives the price set.
  const peak = event('assistant/message', 2, Date.UTC(2026, 7, 13, 2, 30), {
    turn: 1, step: 1, message: { role: 'assistant', content: [] },
    usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
  })
  state = def.apply(state, peak)
  const value = def.view(state)
  assert.equal(value.totals.cost, (1_000_000 * 0.44 + 1_000_000 * 1.32) / 1e6)
})

test('empty report is all zeros', () => {
  const value = emptyUsageReport()
  assert.equal(value.totals.requests, 0)
  assert.deepEqual(value.models, {})
})

test('viewUsage skips untouched model rows', () => {
  const state = {
    route: null,
    models: { 'deepseek-v4-flash': { ...buckets(0, 0), requests: 0, cost: 0 } },
    last: null,
  }
  assert.deepEqual(viewUsage(state), emptyUsageReport())
})

test('auto mode prices flat before the new regime effectiveAt', () => {
  const before = new Date('2026-08-16T15:59:59Z')
  const price = priceFor(DEEPSEEK_PRICES['deepseek-v4-flash'], 'auto', before.getTime())
  assert.equal(price.inputPerMillion, 0.14)
})

test('auto mode prices off-peak after the new regime effectiveAt outside a peak window', () => {
  const after = new Date('2026-08-16T16:00:00Z')
  const price = priceFor(DEEPSEEK_PRICES['deepseek-v4-flash'], 'auto', after.getTime())
  assert.equal(price.inputPerMillion, 0.22)
})

test('auto mode prices peak after the new regime effectiveAt inside a peak window', () => {
  const peakTime = new Date('2026-08-17T07:00:00Z')
  const price = priceFor(DEEPSEEK_PRICES['deepseek-v4-flash'], 'auto', peakTime.getTime())
  assert.equal(price.inputPerMillion, 0.44)
})
