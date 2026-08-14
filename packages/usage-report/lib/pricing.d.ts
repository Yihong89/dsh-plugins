/**
 * Price table for the usage report: one model's USD price per 1M tokens,
 * with an optional peak/off-peak regime for the same model.
 *
 * The shipped defaults are the DeepSeek prices published at
 * https://api-docs.deepseek.com/quick_start/pricing (flat rates as of
 * 2026-08-13, plus the peak/off-peak regime that takes effect at 16:00 UTC on
 * 2026-08-16). DeepSeek may change prices; deployments should restate
 * `prices` from that page.
 *
 * @module dsh-usage-report/pricing
 */
/** USD price per 1M tokens for one model, one regime. */
export interface ModelPrice {
    /** Cache-miss input tokens (also the rate cache-write input is billed at). */
    inputPerMillion: number;
    /** Cache-hit input tokens. */
    cacheReadPerMillion: number;
    /** Generated output tokens. */
    outputPerMillion: number;
}
/** Peak/off-peak regime: off-peak applies outside every peak window. */
export interface PeakOffpeakPricing {
    /** Price inside any {@link peakHoursUtc} window. */
    peak: ModelPrice;
    /** Price outside every peak window. */
    offPeak: ModelPrice;
    /**
     * Peak windows in UTC minutes-of-day as inclusive `[start, end)` intervals;
     * an interval whose `end <= start` wraps midnight.
     */
    peakWindowsUtc: [startMinutes: number, endMinutes: number][];
    /** ISO-8601 UTC instant at which this regime takes effect (e.g. 2026-08-16T16:00:00Z). */
    effectiveAt: string;
}
/** One model's pricing: the always-usable flat rate plus an optional regime. */
export interface ModelPricing {
    flat: ModelPrice;
    peakOffpeak?: PeakOffpeakPricing;
}
/** Model id → pricing. Unknown models are unpriced (cost 0) until added here. */
export type PriceTable = Record<string, ModelPricing>;
/**
 * The shipped DeepSeek price table. `flat` matches the rates in effect on
 * 2026-08-13; `peakOffpeak` matches the regime effective 2026-08-16.
 */
export declare const DEEPSEEK_PRICES: PriceTable;
/** The pricing modes the report can apply. */
export type PricingMode = 'auto' | 'flat' | 'peak-offpeak';
/** Token counts the provider bills on, mirroring the four usage buckets. */
export interface UsageBuckets {
    uncachedInputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
}
/** Whether `minutesOfDay` (UTC) falls inside any peak window. */
export declare function inPeakWindow(windows: [number, number][], minutesOfDay: number): boolean;
/**
 * Pick the price set for one request timestamp under one pricing mode.
 * @param pricing - the model's pricing.
 * @param mode - flat always uses {@link ModelPricing.flat}; peak-offpeak picks peak or off-peak by UTC hour.
 * @param timeMs - Unix epoch milliseconds of the request.
 * @returns the applicable price set.
 */
export declare function priceFor(pricing: ModelPricing, mode: PricingMode, timeMs: number): ModelPrice;
/**
 * Estimated USD cost of one usage sample.
 *
 * Cache-write input is billed at the cache-miss input rate (the harness
 * reports cached input as `cacheReadTokens`/`cacheWriteTokens` and uncached
 * input as `inputTokens`; DeepSeek bills `prompt_cache_hit_tokens` cheaply
 * and everything else at the input rate).
 * @param price - the applicable price set.
 * @param buckets - the sample's token buckets.
 * @returns cost in USD.
 */
export declare function costOf(price: ModelPrice, buckets: UsageBuckets): number;
