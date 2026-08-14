import { jsx as _jsx } from "react/jsx-runtime";
import { costBand, HIGH_COST_THRESHOLD, LOW_COST_THRESHOLD } from "./color.js";
/**
 * Format a USD cost to a compact string, e.g. `$1.25`.
 * @param cost - the estimated cost (USD).
 * @param decimals - decimal places for display (default 2).
 * @returns the `$`-prefixed fixed-point string.
 */
export function formatCost(cost, decimals = 2) {
    return `$${cost.toFixed(decimals)}`;
}
/**
 * Render the current session's estimated cost, color-coded by magnitude.
 * Renders nothing until the projection has a value (no session / no usage yet).
 * @param props - dock-slot props; only `useProjection` is consumed.
 * @returns the cost readout, or `null` when no projection value exists.
 */
export function CostMeter({ useProjection }) {
    // Typed via the SessionProjectionMap augmentation in src/types.ts.
    const value = useProjection('usageReport');
    if (value === undefined)
        return null;
    const cost = value.totals.cost;
    const band = costBand(cost);
    return (_jsx("span", { "data-testid": "usage-cost", "data-band": band, title: `est. cost · band: <$${LOW_COST_THRESHOLD} low, >=$${HIGH_COST_THRESHOLD} high`, children: formatCost(cost) }));
}
//# sourceMappingURL=CostMeter.js.map