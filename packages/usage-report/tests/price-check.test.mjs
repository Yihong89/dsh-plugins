/**
 * Tests for the DeepSeek price-check module. Runs against the built lib.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchDeepseekPrices, diffPrices } from '../lib/price-check.js'
import { DEEPSEEK_PRICES } from '../lib/pricing.js'

/** A minimal Docusaurus-style page carrying the current + new price tables. */
const FIXTURE_HTML = `
  <div><h2>PRICING (1)</h2>
  <p>1M INPUT TOKENS (CACHE HIT) $0.0028 $0.003625</p>
  <p>1M INPUT TOKENS (CACHE MISS) $0.14 $0.435</p>
  <p>1M OUTPUT TOKENS $0.28 $0.87</p>
  <p>The new prices take effect at 16:00 UTC on August 16, 2026, as follows:</p>
  <table>
    <tr><td>MODEL</td></tr>
    <tr><td>deepseek-v4-flash OFF-PEAK $0.007 $0.22 $0.66 PEAK $0.014 $0.44 $1.32</td></tr>
    <tr><td>deepseek-v4-pro OFF-PEAK $0.022 $0.66 $1.98 PEAK $0.044 $1.32 $3.96</td></tr>
  </table></div>
`

function withFetchStub(html, fn) {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, text: async () => html })
  return fn().finally(() => { globalThis.fetch = original })
}

test('fetchDeepseekPrices parses the flat and peak/off-peak tables', async () => {
  await withFetchStub(FIXTURE_HTML, async () => {
    const parsed = await fetchDeepseekPrices('https://example.test/pricing')
    assert.ok(parsed !== undefined)
    assert.equal(parsed.flat.flash.inputPerMillion, 0.14)
    assert.equal(parsed.flat.pro.cacheReadPerMillion, 0.003625)
    assert.equal(parsed.peakOffpeak.flash.peak.outputPerMillion, 1.32)
    assert.equal(parsed.peakOffpeak.pro.offPeak.inputPerMillion, 0.66)
  })
})

test('fetchDeepseekPrices returns undefined on an unparseable page', async () => {
  await withFetchStub('<html>nothing here</html>', async () => {
    const parsed = await fetchDeepseekPrices('https://example.test/pricing')
    assert.equal(parsed, undefined)
  })
})

test('diffPrices reports no diff when the local table matches published', async () => {
  await withFetchStub(FIXTURE_HTML, async () => {
    const parsed = await fetchDeepseekPrices('https://example.test/pricing')
    assert.ok(parsed !== undefined)
    assert.deepEqual(diffPrices(DEEPSEEK_PRICES, parsed), [])
  })
})

test('diffPrices reports a changed flat price', async () => {
  await withFetchStub(FIXTURE_HTML, async () => {
    const parsed = await fetchDeepseekPrices('https://example.test/pricing')
    assert.ok(parsed !== undefined)
    const stale = {
      ...DEEPSEEK_PRICES,
      'deepseek-v4-flash': {
        ...DEEPSEEK_PRICES['deepseek-v4-flash'],
        flat: { ...DEEPSEEK_PRICES['deepseek-v4-flash'].flat, inputPerMillion: 9.99 },
      },
    }
    const diff = diffPrices(stale, parsed)
    assert.equal(diff.length, 1)
    assert.match(diff[0], /deepseek-v4-flash/)
  })
})
