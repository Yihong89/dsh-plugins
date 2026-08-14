/**
 * DeepSeek price-change detection: fetch the published pricing page, parse the
 * flat and peak/off-peak rates, and diff them against the local price table.
 * The page (Docusaurus SSR HTML at https://api-docs.deepseek.com/quick_start/pricing)
 * carries the rates as plain text; parsing is best-effort — any mismatch
 * returns `undefined` so callers fail gracefully.
 * @module dsh-usage-plugin/price-check
 */

import type { ModelPrice, PeakOffpeakPricing, PriceTable } from './pricing.js'

/** Parsed rates from the published page, keyed by the two DeepSeek models. */
export interface ParsedPrices {
  flat: { flash: ModelPrice; pro: ModelPrice }
  peakOffpeak: { flash: PeakOffpeakPricing; pro: PeakOffpeakPricing }
}

/** The two DeepSeek models the check covers. */
const MODELS = { flash: 'deepseek-v4-flash', pro: 'deepseek-v4-pro' } as const

/** Strip tags and collapse whitespace to a single-line document for regexing. */
function toText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

/** Extract the current flat rates (flash then pro) from the page text. */
function parseFlat(text: string): ParsedPrices['flat'] | undefined {
  const m = text.match(
    /1M INPUT TOKENS \(CACHE HIT\) \$(\S+) \$(\S+)[\s\S]*?1M INPUT TOKENS \(CACHE MISS\) \$(\S+) \$(\S+)[\s\S]*?1M OUTPUT TOKENS \$(\S+) \$(\S+)/,
  )
  if (m === null) return undefined
  const [hitF, hitP, missF, missP, outF, outP] = m.slice(1).map(parseFloat)
  if (![hitF, hitP, missF, missP, outF, outP].every((n) => Number.isFinite(n))) return undefined
  return {
    flash: { inputPerMillion: missF!, cacheReadPerMillion: hitF!, outputPerMillion: outF! },
    pro: { inputPerMillion: missP!, cacheReadPerMillion: hitP!, outputPerMillion: outP! },
  }
}

/** Extract the new peak/off-peak rates (flash then pro) from the page text. */
function parsePeakOffpeak(text: string): ParsedPrices['peakOffpeak'] | undefined {
  const m = text.match(
    /deepseek-v4-flash OFF-PEAK \$(\S+) \$(\S+) \$(\S+) PEAK \$(\S+) \$(\S+) \$(\S+)[\s\S]*?deepseek-v4-pro OFF-PEAK \$(\S+) \$(\S+) \$(\S+) PEAK \$(\S+) \$(\S+) \$(\S+)/,
  )
  if (m === null) return undefined
  const nums = m.slice(1).map(parseFloat)
  if (!nums.every((n) => Number.isFinite(n))) return undefined
  const [offFh, offFm, offFo, pkFh, pkFm, pkFo, offPh, offPm, offPo, pkPh, pkPm, pkPo] = nums
  const windows: PeakOffpeakPricing['peakWindowsUtc'] = [[1 * 60, 4 * 60], [6 * 60, 10 * 60]]
  const effectiveAt = '2026-08-16T16:00:00Z'
  const make = (peak: ModelPrice, offPeak: ModelPrice): PeakOffpeakPricing =>
    ({ peak, offPeak, peakWindowsUtc: windows, effectiveAt })
  return {
    flash: make(
      { inputPerMillion: pkFm!, cacheReadPerMillion: pkFh!, outputPerMillion: pkFo! },
      { inputPerMillion: offFm!, cacheReadPerMillion: offFh!, outputPerMillion: offFo! },
    ),
    pro: make(
      { inputPerMillion: pkPm!, cacheReadPerMillion: pkPh!, outputPerMillion: pkPo! },
      { inputPerMillion: offPm!, cacheReadPerMillion: offPh!, outputPerMillion: offPo! },
    ),
  }
}

/**
 * Fetch and parse DeepSeek's published prices.
 * @param url - the pricing page URL.
 * @returns the parsed rates, or `undefined` when the fetch or parse fails.
 */
export async function fetchDeepseekPrices(url: string): Promise<ParsedPrices | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return undefined
    const text = toText(await response.text())
    const flat = parseFlat(text)
    const peakOffpeak = parsePeakOffpeak(text)
    if (flat === undefined || peakOffpeak === undefined) return undefined
    return { flat, peakOffpeak }
  } catch {
    return undefined
  }
}

/**
 * Diff the local flat table against the parsed rates. Returns one line per
 * model whose flat price differs (or is missing); empty when they match.
 * @param local - the local price table.
 * @param parsed - parsed rates from the published page.
 * @returns human-readable diff lines.
 */
export function diffPrices(local: PriceTable, parsed: ParsedPrices): string[] {
  const lines: string[] = []
  for (const [key, model] of Object.entries(MODELS)) {
    const k = key as keyof typeof MODELS
    const localFlat = local[model]?.flat
    const want = parsed.flat[k]
    if (localFlat === undefined
      || localFlat.inputPerMillion !== want.inputPerMillion
      || localFlat.cacheReadPerMillion !== want.cacheReadPerMillion
      || localFlat.outputPerMillion !== want.outputPerMillion) {
      lines.push(`${model} flat: local ${JSON.stringify(localFlat)} vs published ${JSON.stringify(want)}`)
    }
  }
  return lines
}
