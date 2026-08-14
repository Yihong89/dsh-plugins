/**
 * Color thresholds for the live cost readout (USD). Pure, testable, and free
 * of React/dsh imports.
 * @module dsh-usage-report/client/color
 */
/** Costs below this (USD) render in the low band. */
export declare const LOW_COST_THRESHOLD = 1;
/** Costs at or above this (USD) render in the high band; between is mid. */
export declare const HIGH_COST_THRESHOLD = 5;
/** A cost's magnitude band: 'low' | 'mid' | 'high'. */
export type CostBand = 'low' | 'mid' | 'high';
/**
 * Classify a USD cost into a magnitude band for color coding.
 * @param cost - estimated USD cost (non-negative).
 * @returns 'low' below {@link LOW_COST_THRESHOLD}, 'high' at/above
 *   {@link HIGH_COST_THRESHOLD}, otherwise 'mid'.
 */
export declare function costBand(cost: number): CostBand;
