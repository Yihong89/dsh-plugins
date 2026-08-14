/**
 * dsh-usage-report: per-session token usage and estimated cost for DeepSeek
 * Harness. One host-plane plugin row registers three things:
 *
 * - the `usageReport` session-projection unit, folding provider-reported
 *   usage (attributed per model from `request/header` routes) and pricing
 *   each sample with the configured price table;
 * - the `/usage` human command, printing the current session's report;
 * - the `usage_report` model tool, returning the report as canonical JSON.
 *
 * @module dsh-usage-report
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import {
  DEEPSEEK_PRICES,
  type ModelPricing,
  type PriceTable,
  type PricingMode,
} from './pricing.js'
import { usageReportProjectionWith, emptyUsageReport, type FoldOptions } from './usage-fold.js'
import { formatReport, DEFAULT_COST_DECIMALS } from './format.js'
import { diffPrices, fetchDeepseekPrices } from './price-check.js'
import type { ModelUsage, UsageReportValue } from './types.js'
import type {} from './types.js'

/** Default source for the price check: DeepSeek's published pricing page. */
const DEFAULT_PRICE_CHECK_URL = 'https://api-docs.deepseek.com/quick_start/pricing'

export const name = 'dsh-usage-report'
export const inject = ['tools', 'commands']

/** Plugin configuration, settable from the cordis.yml entry's `config:` block. */
export interface Config {
  /**
   * Which price regime the estimated cost uses: `'flat'` (single rates) or
   * `'peak-offpeak'` (rates vary by UTC hour, DeepSeek's regime effective
   * 2026-08-16). Default `'flat'`.
   */
  pricing: PricingMode
  /**
   * Per-model price overrides, merged over the shipped DeepSeek table. A
   * model with no entry is unpriced (its tokens still count, cost 0). Shape
   * per model: `{ flat: {inputPerMillion, cacheReadPerMillion,
   * outputPerMillion}, peakOffpeak?: {peak: {...}, offPeak: {...},
   * peakWindowsUtc: [[startMinutes, endMinutes], ...]} }`.
   */
  prices?: Record<string, unknown>
  /** Model attributed to usage with no preceding `request/header` (default `'unknown'`). */
  defaultModel?: string
  /** Decimal places for USD cost in text output (default 6). */
  costDecimals?: number
  /** URL of the DeepSeek pricing page used by `/usage check-prices` (default api-docs.deepseek.com). */
  priceCheckUrl?: string
}

export const Config: z<Config> = z.object({
  pricing: z.union([z.const('auto'), z.const('flat'), z.const('peak-offpeak')]).default('auto'),
  prices: z.dict(z.any()),
  defaultModel: z.string(),
  costDecimals: z.number(),
  priceCheckUrl: z.string(),
})

/** Fail loudly on a malformed `prices` entry rather than silently underpricing. */
function assertPriceShape(model: string, raw: unknown): void {
  const pricing = raw as Partial<ModelPricing> | undefined
  const flat = pricing?.flat as Partial<ModelPricing['flat']> | undefined
  const numbers = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  if (flat === undefined
    || !numbers(flat.inputPerMillion) || flat.inputPerMillion < 0
    || !numbers(flat.cacheReadPerMillion) || flat.cacheReadPerMillion < 0
    || !numbers(flat.outputPerMillion) || flat.outputPerMillion < 0) {
    throw new Error(
      `dsh-usage-report: prices[${JSON.stringify(model)}] must be { flat: { inputPerMillion, `
      + 'cacheReadPerMillion, outputPerMillion } } with non-negative numbers',
    )
  }
  const regime = pricing?.peakOffpeak
  if (regime === undefined) return
  for (const part of ['peak', 'offPeak'] as const) {
    const price = regime[part] as Partial<ModelPricing['flat']> | undefined
    if (price === undefined
      || !numbers(price.inputPerMillion) || !numbers(price.cacheReadPerMillion) || !numbers(price.outputPerMillion)) {
      throw new Error(`dsh-usage-report: prices[${JSON.stringify(model)}].peakOffpeak.${part} must be a full price set`)
    }
  }
  if (!Array.isArray(regime.peakWindowsUtc) || regime.peakWindowsUtc.length === 0) {
    throw new Error(`dsh-usage-report: prices[${JSON.stringify(model)}].peakOffpeak.peakWindowsUtc must be a non-empty array of [start, end) minute-of-day windows`)
  }
}

/** Merge user price overrides over the shipped DeepSeek table. */
function mergePrices(overrides: Record<string, unknown> | undefined): PriceTable {
  if (overrides === undefined) return DEEPSEEK_PRICES
  const merged: PriceTable = { ...DEEPSEEK_PRICES }
  for (const [model, raw] of Object.entries(overrides)) {
    assertPriceShape(model, raw)
    merged[model] = raw as ModelPricing
  }
  return merged
}

/** The tool's canonical value: totals plus one row per model (schema-friendly array). */
export interface UsageReportToolValue {
  totals: ModelUsage
  models: { model: string; usage: ModelUsage }[]
}

const usageProps = {
  type: 'object',
  additionalProperties: false,
  properties: {
    uncachedInputTokens: { type: 'integer', required: true },
    cacheReadTokens: { type: 'integer', required: true },
    cacheWriteTokens: { type: 'integer', required: true },
    outputTokens: { type: 'integer', required: true },
    requests: { type: 'integer', required: true },
    cost: { type: 'number', required: true },
  },
} as const

/**
 * Register the projection unit, the `/usage` command, and the `usage_report`
 * tool on the calling context.
 * @param ctx - registrant context carrying the tool and command registries.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const prices = mergePrices(config.prices)
  const mode: PricingMode = config.pricing ?? 'auto'
  const costDecimals = config.costDecimals ?? DEFAULT_COST_DECIMALS
  const priceState = { available: false }
  const foldOptions: FoldOptions = {
    prices,
    mode,
    ...(config.defaultModel === undefined ? {} : { defaultModel: config.defaultModel }),
    priceUpdateAvailable: () => priceState.available,
  }

  // Fire-and-forget boot check: a detected DeepSeek price change flags the
  // projection so the dock badge and /usage can surface it. Never throws.
  void (async () => {
    const parsed = await fetchDeepseekPrices(config.priceCheckUrl ?? DEFAULT_PRICE_CHECK_URL)
    if (parsed !== undefined && diffPrices(prices, parsed).length > 0) priceState.available = true
  })()

  // The projection unit registers only when the session-projection seam is
  // composed; the command and tool read the report through ctx.get and work
  // without it (empty report until the seam exists).
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(usageReportProjectionWith(foldOptions))
  })

  const readReport = (session: Session): UsageReportValue => {
    const registry = ctx.get('sessionProjections') as SessionProjectionRegistry | undefined
    if (registry === undefined) return emptyUsageReport()
    return registry.snapshot(session).values.usageReport ?? emptyUsageReport()
  }

  ctx.commands.register({
    name: 'usage',
    description: 'Show this session\'s token usage and estimated cost',
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const input = invocation.rawInput.trim()
      if (input === 'check-prices') {
        const parsed = await fetchDeepseekPrices(config.priceCheckUrl ?? DEFAULT_PRICE_CHECK_URL)
        if (parsed === undefined) {
          return { kind: 'error', text: 'Could not verify DeepSeek prices (fetch or parse failed).' }
        }
        const diff = diffPrices(prices, parsed)
        if (diff.length === 0) {
          return { kind: 'success', text: 'DeepSeek prices are up to date — the local table matches api-docs.deepseek.com.' }
        }
        return {
          kind: 'success',
          text: '⚠ DeepSeek prices changed on api-docs.deepseek.com:\n' + diff.join('\n')
            + '\nUpdate the `prices` table in cordis.patch.yml.',
        }
      }
      if (input.length > 0) {
        return { kind: 'error', text: 'Usage: /usage (no arguments) or /usage check-prices' }
      }
      const value = readReport(invocation.agent.session)
      let text = formatReport(value, prices, costDecimals, mode)
      if (value.priceUpdateAvailable) {
        text += '\n⚠ DeepSeek prices changed on api-docs.deepseek.com — update the `prices` table in cordis.patch.yml (see /usage check-prices).'
      }
      if (value.unpricedModels.length > 0) {
        text += `\n⚠ unpriced models: ${value.unpricedModels.join(', ')} — add them under \`prices\` in cordis.patch.yml.`
      }
      return { kind: 'success', text }
    },
  })

  ctx.tools.register(defineTool({
    name: 'usage_report',
    description: 'Report the current session\'s provider-reported token usage and estimated cost. '
      + 'Token buckets are uncached input, cache-read input, cache-write input, and output; '
      + 'cost is estimated from the configured price table and is not a billing record.',
    parameters: {
      detail: {
        type: 'string',
        enum: ['summary', 'per-model'],
        description: 'Which detail to render in the text projection (the canonical value always carries both). Default: per-model.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          totals: { ...usageProps, required: true },
          models: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                model: { type: 'string', required: true },
                usage: { ...usageProps, required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const byModel: Record<string, ModelUsage> = {}
        for (const row of value.models) byModel[row.model] = row.usage
        return [{
          type: 'text',
          text: formatReport({ totals: value.totals, models: byModel }, prices, costDecimals, mode),
        }]
      },
    },
    async execute(_args, exec) {
      if (exec.agent === undefined) {
        throw new Error('usage_report requires an owning agent session')
      }
      const value = readReport(exec.agent.session)
      return {
        totals: value.totals,
        models: Object.entries(value.models).map(([model, usage]) => ({ model, usage })),
      } satisfies UsageReportToolValue
    },
  }))
}
