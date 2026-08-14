/**
 * Color thresholds for the live cost readout (USD). Pure, testable, and free
 * of React/dsh imports.
 * @module dsh-usage-report/client/color
 */
/** Costs below this (USD) render in the low band. */
export const LOW_COST_THRESHOLD = 1.0;
/** Costs at or above this (USD) render in the high band; between is mid. */
export const HIGH_COST_THRESHOLD = 5.0;
/**
 * Classify a USD cost into a magnitude band for color coding.
 * @param cost - estimated USD cost (non-negative).
 * @returns 'low' below {@link LOW_COST_THRESHOLD}, 'high' at/above
 *   {@link HIGH_COST_THRESHOLD}, otherwise 'mid'.
 */
export function costBand(cost) {
    if (cost < LOW_COST_THRESHOLD)
        return 'low';
    if (cost >= HIGH_COST_THRESHOLD)
        return 'high';
    return 'mid';
}
//# sourceMappingURL=color.js.map