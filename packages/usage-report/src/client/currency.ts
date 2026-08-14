/**
 * Currency display helpers for the live cost readout. Pure and testable; the
 * USD→CNY rate is a fixed default constant (no live fetch), adjustable at the
 * call site when configuration plumbing is added.
 * @module dsh-usage-report/client/currency
 */

/** Default USD→CNY exchange rate used to render the CNY figure (2026-08). */
export const USD_TO_CNY = 7.2

/**
 * Convert a USD amount to CNY using {@link USD_TO_CNY}.
 * @param costUsd - the estimated cost in USD (non-negative).
 * @returns the estimated cost in CNY.
 */
export function usdToCny(costUsd: number): number {
  return costUsd * USD_TO_CNY
}

/**
 * Format a CNY amount as `¥X.XX`.
 * @param costCny - the estimated cost in CNY.
 * @param decimals - decimal places for display (default 2).
 * @returns the `¥`-prefixed fixed-point string.
 */
export function formatCny(costCny: number, decimals = 2): string {
  return `¥${costCny.toFixed(decimals)}`
}
