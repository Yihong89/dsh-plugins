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
/**
 * The shipped DeepSeek price table. `flat` matches the rates in effect on
 * 2026-08-13; `peakOffpeak` matches the regime effective 2026-08-16.
 */
export const DEEPSEEK_PRICES = {
    'deepseek-v4-flash': {
        flat: { inputPerMillion: 0.14, cacheReadPerMillion: 0.0028, outputPerMillion: 0.28 },
        peakOffpeak: {
            peak: { inputPerMillion: 0.44, cacheReadPerMillion: 0.014, outputPerMillion: 1.32 },
            offPeak: { inputPerMillion: 0.22, cacheReadPerMillion: 0.007, outputPerMillion: 0.66 },
            peakWindowsUtc: [[1 * 60, 4 * 60], [6 * 60, 10 * 60]],
            effectiveAt: '2026-08-16T16:00:00Z',
        },
    },
    'deepseek-v4-pro': {
        flat: { inputPerMillion: 0.435, cacheReadPerMillion: 0.003625, outputPerMillion: 0.87 },
        peakOffpeak: {
            peak: { inputPerMillion: 1.32, cacheReadPerMillion: 0.044, outputPerMillion: 3.96 },
            offPeak: { inputPerMillion: 0.66, cacheReadPerMillion: 0.022, outputPerMillion: 1.98 },
            peakWindowsUtc: [[1 * 60, 4 * 60], [6 * 60, 10 * 60]],
            effectiveAt: '2026-08-16T16:00:00Z',
        },
    },
};
/** Whether `minutesOfDay` (UTC) falls inside any peak window. */
export function inPeakWindow(windows, minutesOfDay) {
    return windows.some(([start, end]) => end > start
        ? minutesOfDay >= start && minutesOfDay < end
        : minutesOfDay >= start || minutesOfDay < end);
}
/**
 * Pick the price set for one request timestamp under one pricing mode.
 * @param pricing - the model's pricing.
 * @param mode - flat always uses {@link ModelPricing.flat}; peak-offpeak picks peak or off-peak by UTC hour.
 * @param timeMs - Unix epoch milliseconds of the request.
 * @returns the applicable price set.
 */
export function priceFor(pricing, mode, timeMs) {
    if (mode === 'auto') {
        mode = pricing.peakOffpeak !== undefined && timeMs >= Date.parse(pricing.peakOffpeak.effectiveAt)
            ? 'peak-offpeak'
            : 'flat';
    }
    if (mode !== 'peak-offpeak' || pricing.peakOffpeak === undefined)
        return pricing.flat;
    const regime = pricing.peakOffpeak;
    const date = new Date(timeMs);
    const minutesOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
    return inPeakWindow(regime.peakWindowsUtc, minutesOfDay) ? regime.peak : regime.offPeak;
}
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
export function costOf(price, buckets) {
    const billedInput = buckets.uncachedInputTokens + buckets.cacheWriteTokens;
    return (billedInput * price.inputPerMillion
        + buckets.cacheReadTokens * price.cacheReadPerMillion
        + buckets.outputTokens * price.outputPerMillion) / 1_000_000;
}
//# sourceMappingURL=pricing.js.map