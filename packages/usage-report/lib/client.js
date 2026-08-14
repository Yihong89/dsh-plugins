window.__ModuleLoader__.load({
	id: "dsh-usage-report",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
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
		//#region lib/types/client/currency.js
		/**
		* Currency display helpers for the live cost readout. Pure and testable; the
		* USD→CNY rate is a fixed default constant (no live fetch), adjustable at the
		* call site when configuration plumbing is added.
		* @module dsh-usage-report/client/currency
		*/
		/** Default USD→CNY exchange rate used to render the CNY figure (2026-08). */
		const USD_TO_CNY = 7.2;
		/**
		* Convert a USD amount to CNY using {@link USD_TO_CNY}.
		* @param costUsd - the estimated cost in USD (non-negative).
		* @returns the estimated cost in CNY.
		*/
		function usdToCny(costUsd) {
			return costUsd * USD_TO_CNY;
		}
		/**
		* Format a CNY amount as `¥X.XX`.
		* @param costCny - the estimated cost in CNY.
		* @param decimals - decimal places for display (default 2).
		* @returns the `¥`-prefixed fixed-point string.
		*/
		function formatCny(costCny, decimals = 2) {
			return `¥${costCny.toFixed(decimals)}`;
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
		* Render the current session's estimated cost in USD and CNY, color-coded by
		* magnitude (banded on the USD figure). Renders nothing until the projection
		* has a value (no session / no usage yet).
		* @param props - dock-slot props; only `useProjection` is consumed.
		* @returns the cost readout, or `null` when no projection value exists.
		*/
		function CostMeter({ useProjection }) {
			const value = useProjection("usageReport");
			if (value === void 0) return null;
			const cost = value.totals.cost;
			const band = costBand(cost);
			return (0, react_jsx_runtime.jsxs)("span", {
				"data-testid": "usage-cost",
				"data-band": band,
				title: `est. cost · band: <$1 low, >=$5 high`,
				children: [
					formatCost(cost),
					" · ",
					formatCny(usdToCny(cost))
				]
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
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map