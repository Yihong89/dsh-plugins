Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react_jsx_runtime = require("react/jsx-runtime");
/**
* Classify a USD cost into a magnitude band for color coding.
* @param cost - estimated USD cost (non-negative).
* @returns 'low' below {@link LOW_COST_THRESHOLD}, 'high' at/above
*   {@link HIGH_COST_THRESHOLD}, otherwise 'mid'.
*/
function costBand(cost) {
	if (cost < 1) return "low";
	if (cost >= 5) return "high";
	return "mid";
}
//#endregion
//#region lib/types/client/CostMeter.js
/**
* Format a USD cost to a compact string, e.g. `$1.25`.
* @param cost - the estimated cost (USD).
* @param decimals - decimal places for display (default 2).
* @returns the `$`-prefixed fixed-point string.
*/
function formatCost(cost, decimals = 2) {
	return `$${cost.toFixed(decimals)}`;
}
/**
* Render the current session's estimated cost, color-coded by magnitude.
* Renders nothing until the projection has a value (no session / no usage yet).
* @param props - dock-slot props; only `useProjection` is consumed.
* @returns the cost readout, or `null` when no projection value exists.
*/
function CostMeter({ useProjection }) {
	const value = useProjection("usageReport");
	if (value === void 0) return null;
	const cost = value.totals.cost;
	const band = costBand(cost);
	return (0, react_jsx_runtime.jsx)("span", {
		"data-testid": "usage-cost",
		"data-band": band,
		title: `est. cost · band: <$1 low, >=$5 high`,
		children: formatCost(cost)
	});
}
//#endregion
//#region lib/types/client/index.js
/**
* Client half of dsh-usage-report: contributes the live session-cost readout
* to the web composer dock. Registers one list entry into the
* `conversation.composer.dock` slot; the component reads the host's
* `usageReport` projection and renders nothing until a value exists.
* @module dsh-usage-report/client
*/
/** Cordis plugin name used by loader diagnostics. */
const name = "dsh-usage-report/client";
/** Services required by this plugin. */
const inject = ["sessions", "slots"];
/**
* Register the cost readout into the composer dock on the client context.
* @param ctx - client root context.
*/
function apply(ctx) {
	ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
		name: "conversation.composer.dock",
		id: "usage-cost",
		order: 5
	}, CostMeter));
}
//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;

//# sourceMappingURL=client.cjs.map