/**
 * Human-readable rendering of a usage report for the `/usage` command and the
 * `usage_report` tool's model-facing text.
 *
 * @module dsh-usage-report/format
 */

import type { UsageReportValue } from './types.js'
import type { PriceTable } from './pricing.js'

/** How many decimals to render cost with (DeepSeek bills per 1M tokens, so USD costs are small). */
export const DEFAULT_COST_DECIMALS = 6

const pad = (value: string, width: number): string => value.length >= width ? value : value + ' '.repeat(width - value.length)

const fmt = (n: number): string => n.toLocaleString('en-US')

/** Render one report as a fixed-width text table. */
export function formatReport(
  value: UsageReportValue,
  prices: PriceTable,
  costDecimals = DEFAULT_COST_DECIMALS,
  modeLabel = 'flat',
): string {
  const models = Object.entries(value.models).sort(([a], [b]) => a.localeCompare(b))
  const header = pad('model', 24) + pad('uncached-input', 16) + pad('cache-read', 12) + pad('cache-write', 13)
    + pad('output', 12) + pad('requests', 9) + 'est. cost'
  const unpriced = models.filter(([model]) => prices[model] === undefined && model !== 'unknown')

  const lines = [header, ...models.map(([model, usage]) => [
    pad(model, 24),
    pad(fmt(usage.uncachedInputTokens), 16),
    pad(fmt(usage.cacheReadTokens), 12),
    pad(fmt(usage.cacheWriteTokens), 13),
    pad(fmt(usage.outputTokens), 12),
    pad(String(usage.requests), 9),
    prices[model] === undefined && model !== 'unknown' ? 'unpriced' : `$${usage.cost.toFixed(costDecimals)}`,
  ].join(''))]

  const t = value.totals
  lines.push(pad('Total', 24) + pad(fmt(t.uncachedInputTokens), 16) + pad(fmt(t.cacheReadTokens), 12)
    + pad(fmt(t.cacheWriteTokens), 13) + pad(fmt(t.outputTokens), 12) + pad(String(t.requests), 9)
    + `$${t.cost.toFixed(costDecimals)}`)

  const notes: string[] = []
  if (t.requests === 0) notes.push('No provider-reported usage in this session yet.')
  if (modeLabel === 'peak-offpeak') notes.push('Cost computed with peak/off-peak pricing by request time (UTC).')
  if (unpriced.length > 0) notes.push(`Unpriced model(s): ${unpriced.map(([m]) => m).join(', ')} — add prices in the plugin config.`)
  return ['Session usage report', ...lines, ...notes].join('\n')
}
