/**
 * DeepSeek price-change detection: fetch the published pricing page, parse the
 * flat and peak/off-peak rates, and diff them against the local price table.
 * The page (Docusaurus SSR HTML at https://api-docs.deepseek.com/quick_start/pricing)
 * carries the rates as plain text; parsing is best-effort — any mismatch
 * returns `undefined` so callers fail gracefully.
 * @module dsh-usage-plugin/price-check
 */
import type { ModelPrice, PeakOffpeakPricing, PriceTable } from './pricing.js';
/** Parsed rates from the published page, keyed by the two DeepSeek models. */
export interface ParsedPrices {
    flat: {
        flash: ModelPrice;
        pro: ModelPrice;
    };
    peakOffpeak: {
        flash: PeakOffpeakPricing;
        pro: PeakOffpeakPricing;
    };
}
/**
 * Fetch and parse DeepSeek's published prices.
 * @param url - the pricing page URL.
 * @returns the parsed rates, or `undefined` when the fetch or parse fails.
 */
export declare function fetchDeepseekPrices(url: string): Promise<ParsedPrices | undefined>;
/**
 * Diff the local flat table against the parsed rates. Returns one line per
 * model whose flat price differs (or is missing); empty when they match.
 * @param local - the local price table.
 * @param parsed - parsed rates from the published page.
 * @returns human-readable diff lines.
 */
export declare function diffPrices(local: PriceTable, parsed: ParsedPrices): string[];
