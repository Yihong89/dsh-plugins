import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z as z$1 } from "zod";
//#region lib/types/pricing.js
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
const DEEPSEEK_PRICES = {
	"deepseek-v4-flash": {
		flat: {
			inputPerMillion: .14,
			cacheReadPerMillion: .0028,
			outputPerMillion: .28
		},
		peakOffpeak: {
			peak: {
				inputPerMillion: .44,
				cacheReadPerMillion: .014,
				outputPerMillion: 1.32
			},
			offPeak: {
				inputPerMillion: .22,
				cacheReadPerMillion: .007,
				outputPerMillion: .66
			},
			peakWindowsUtc: [[60, 240], [360, 600]]
		}
	},
	"deepseek-v4-pro": {
		flat: {
			inputPerMillion: .435,
			cacheReadPerMillion: .003625,
			outputPerMillion: .87
		},
		peakOffpeak: {
			peak: {
				inputPerMillion: 1.32,
				cacheReadPerMillion: .044,
				outputPerMillion: 3.96
			},
			offPeak: {
				inputPerMillion: .66,
				cacheReadPerMillion: .022,
				outputPerMillion: 1.98
			},
			peakWindowsUtc: [[60, 240], [360, 600]]
		}
	}
};
/** Whether `minutesOfDay` (UTC) falls inside any peak window. */
function inPeakWindow(windows, minutesOfDay) {
	return windows.some(([start, end]) => end > start ? minutesOfDay >= start && minutesOfDay < end : minutesOfDay >= start || minutesOfDay < end);
}
/**
* Pick the price set for one request timestamp under one pricing mode.
* @param pricing - the model's pricing.
* @param mode - flat always uses {@link ModelPricing.flat}; peak-offpeak picks peak or off-peak by UTC hour.
* @param timeMs - Unix epoch milliseconds of the request.
* @returns the applicable price set.
*/
function priceFor(pricing, mode, timeMs) {
	if (mode !== "peak-offpeak" || pricing.peakOffpeak === void 0) return pricing.flat;
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
function costOf(price, buckets) {
	return ((buckets.uncachedInputTokens + buckets.cacheWriteTokens) * price.inputPerMillion + buckets.cacheReadTokens * price.cacheReadPerMillion + buckets.outputTokens * price.outputPerMillion) / 1e6;
}
//#endregion
//#region lib/types/usage-fold.js
/**
* The `usageReport` projection unit: a pure fold over session events that
* attributes provider-reported usage to the model named by the nearest
* preceding `request/header` route, mirroring token-meter's
* last-sample-replacing semantics per (turn, step), and prices each sample
* with the configured price table.
*
* @module dsh-usage-report/usage-fold
*/
const zeroUsage = () => ({
	uncachedInputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	outputTokens: 0,
	requests: 0,
	cost: 0
});
/** The provider-reported usage of one event, if any (mirrors token-meter). */
function usageOf(event) {
	if (event.type === "assistant/chunk" && event.data.chunk.type === "usage") {
		const usage = event.data.chunk.usage;
		return {
			turn: event.data.turn,
			step: event.data.step,
			timeMs: event.time,
			buckets: {
				uncachedInputTokens: usage.inputTokens,
				cacheReadTokens: usage.cacheReadTokens ?? 0,
				cacheWriteTokens: usage.cacheWriteTokens ?? 0,
				outputTokens: usage.outputTokens
			}
		};
	}
	if (event.type === "assistant/message" && event.data.usage !== void 0) {
		const usage = event.data.usage;
		return {
			turn: event.data.turn,
			step: event.data.step,
			timeMs: event.time,
			buckets: {
				uncachedInputTokens: usage.inputTokens,
				cacheReadTokens: usage.cacheReadTokens ?? 0,
				cacheWriteTokens: usage.cacheWriteTokens ?? 0,
				outputTokens: usage.outputTokens
			}
		};
	}
}
const bucketKeys = [
	"uncachedInputTokens",
	"cacheReadTokens",
	"cacheWriteTokens",
	"outputTokens"
];
/** Add `next` bucket values to `base`, returning a new object. */
function addBuckets(base, next, requests, cost) {
	const result = {
		...base,
		requests,
		cost
	};
	for (const key of bucketKeys) result[key] = base[key] + next[key];
	return result;
}
/** Subtract `removed` bucket values from `base`, returning a new object. */
function subtractBuckets(base, removed, requests, cost) {
	const result = {
		...base,
		requests,
		cost
	};
	for (const key of bucketKeys) result[key] = base[key] - removed[key];
	return result;
}
/**
* Fold one event onto the usage-report state. Returns the same reference when
* the event is not the unit's (the projection registry's zero-work contract).
*/
function applyUsage(state, event, options) {
	if (event.type === "request/header") {
		const config = event.data.header.config;
		if (config.provider === state.route?.provider && config.model === state.route?.model) return state;
		return {
			...state,
			route: {
				provider: config.provider,
				model: config.model
			}
		};
	}
	const sample = usageOf(event);
	if (sample === void 0) return state;
	const model = state.route?.model ?? options.defaultModel ?? "unknown";
	const price = options.prices[model];
	const cost = price === void 0 ? 0 : costOf(priceFor(price, options.mode, sample.timeMs), sample.buckets);
	const previous = state.last !== null && state.last.turn === sample.turn && state.last.step === sample.step ? state.last : void 0;
	if (previous !== void 0) {
		const models = { ...state.models };
		const current = models[previous.model] ?? zeroUsage();
		models[previous.model] = subtractBuckets(current, previous.buckets, current.requests - 1, current.cost - previous.cost);
		const target = models[model] ?? zeroUsage();
		models[model] = addBuckets(target, sample.buckets, target.requests + 1, target.cost + cost);
		return {
			...state,
			models,
			last: {
				turn: sample.turn,
				step: sample.step,
				model,
				buckets: sample.buckets,
				cost
			}
		};
	}
	const models = { ...state.models };
	const target = models[model] ?? zeroUsage();
	models[model] = addBuckets(target, sample.buckets, target.requests + 1, target.cost + cost);
	return {
		...state,
		models,
		last: {
			turn: sample.turn,
			step: sample.step,
			model,
			buckets: sample.buckets,
			cost
		}
	};
}
/** Derive the wire payload: per-model usage plus the totals across models. */
function viewUsage(state) {
	const totals = zeroUsage();
	const models = {};
	for (const [model, usage] of Object.entries(state.models)) {
		if (usage.requests === 0 && usage.cost === 0 && usage.uncachedInputTokens === 0 && usage.cacheReadTokens === 0 && usage.cacheWriteTokens === 0 && usage.outputTokens === 0) continue;
		models[model] = usage;
		totals.uncachedInputTokens += usage.uncachedInputTokens;
		totals.cacheReadTokens += usage.cacheReadTokens;
		totals.cacheWriteTokens += usage.cacheWriteTokens;
		totals.outputTokens += usage.outputTokens;
		totals.requests += usage.requests;
		totals.cost += usage.cost;
	}
	return {
		totals,
		models
	};
}
const usageSchema = z$1.object({
	uncachedInputTokens: z$1.number().int().nonnegative(),
	cacheReadTokens: z$1.number().int().nonnegative(),
	cacheWriteTokens: z$1.number().int().nonnegative(),
	outputTokens: z$1.number().int().nonnegative(),
	requests: z$1.number().int().nonnegative(),
	cost: z$1.number().nonnegative()
}).strict();
/** Wire schema of the `usageReport` projection value. */
const usageReportSchema = z$1.object({
	totals: usageSchema,
	models: z$1.record(z$1.string(), usageSchema)
}).strict();
/**
* Bind the fold to a resolved price table. Returns a fresh definition whose
* `apply` closes over the options.
*/
function usageReportProjectionWith(options) {
	return {
		key: "usageReport",
		schema: usageReportSchema,
		init: () => ({
			route: null,
			models: {},
			last: null
		}),
		apply: (state, event) => applyUsage(state, event, options),
		view: viewUsage,
		stateVersion: 1
	};
}
/** An empty report, for sessions with no usage yet. */
function emptyUsageReport() {
	return {
		totals: zeroUsage(),
		models: {}
	};
}
const pad = (value, width) => value.length >= width ? value : value + " ".repeat(width - value.length);
const fmt = (n) => n.toLocaleString("en-US");
/** Render one report as a fixed-width text table. */
function formatReport(value, prices, costDecimals = 6, modeLabel = "flat") {
	const models = Object.entries(value.models).sort(([a], [b]) => a.localeCompare(b));
	const header = pad("model", 24) + pad("uncached-input", 16) + pad("cache-read", 12) + pad("cache-write", 13) + pad("output", 12) + pad("requests", 9) + "est. cost";
	const unpriced = models.filter(([model]) => prices[model] === void 0 && model !== "unknown");
	const lines = [header, ...models.map(([model, usage]) => [
		pad(model, 24),
		pad(fmt(usage.uncachedInputTokens), 16),
		pad(fmt(usage.cacheReadTokens), 12),
		pad(fmt(usage.cacheWriteTokens), 13),
		pad(fmt(usage.outputTokens), 12),
		pad(String(usage.requests), 9),
		prices[model] === void 0 && model !== "unknown" ? "unpriced" : `$${usage.cost.toFixed(costDecimals)}`
	].join(""))];
	const t = value.totals;
	lines.push(pad("Total", 24) + pad(fmt(t.uncachedInputTokens), 16) + pad(fmt(t.cacheReadTokens), 12) + pad(fmt(t.cacheWriteTokens), 13) + pad(fmt(t.outputTokens), 12) + pad(String(t.requests), 9) + `$${t.cost.toFixed(costDecimals)}`);
	const notes = [];
	if (t.requests === 0) notes.push("No provider-reported usage in this session yet.");
	if (modeLabel === "peak-offpeak") notes.push("Cost computed with peak/off-peak pricing by request time (UTC).");
	if (unpriced.length > 0) notes.push(`Unpriced model(s): ${unpriced.map(([m]) => m).join(", ")} — add prices in the plugin config.`);
	return [
		"Session usage report",
		...lines,
		...notes
	].join("\n");
}
//#endregion
//#region lib/types/index.js
/**
* dsh-usage-report: per-session token usage and estimated cost for DeepSeek
* Harness. One host-plane plugin row registers three things:
*
* - the `usageReport` session-projection unit, folding provider-reported
*   usage (attributed per model from `request/header` routes) and pricing
*   each sample with the configured price table;
* - the `/usage` human command, printing the current session's report;
* - the `usage_report` model tool, returning the report as canonical JSON.
*
* @module dsh-usage-report
*/
const name = "dsh-usage-report";
const inject = ["tools", "commands"];
const Config = z.object({
	pricing: z.union([z.const("flat"), z.const("peak-offpeak")]).default("flat"),
	prices: z.dict(z.any()),
	defaultModel: z.string(),
	costDecimals: z.number()
});
/** Fail loudly on a malformed `prices` entry rather than silently underpricing. */
function assertPriceShape(model, raw) {
	const pricing = raw;
	const flat = pricing?.flat;
	const numbers = (value) => typeof value === "number" && Number.isFinite(value);
	if (flat === void 0 || !numbers(flat.inputPerMillion) || flat.inputPerMillion < 0 || !numbers(flat.cacheReadPerMillion) || flat.cacheReadPerMillion < 0 || !numbers(flat.outputPerMillion) || flat.outputPerMillion < 0) throw new Error(`dsh-usage-report: prices[${JSON.stringify(model)}] must be { flat: { inputPerMillion, cacheReadPerMillion, outputPerMillion } } with non-negative numbers`);
	const regime = pricing?.peakOffpeak;
	if (regime === void 0) return;
	for (const part of ["peak", "offPeak"]) {
		const price = regime[part];
		if (price === void 0 || !numbers(price.inputPerMillion) || !numbers(price.cacheReadPerMillion) || !numbers(price.outputPerMillion)) throw new Error(`dsh-usage-report: prices[${JSON.stringify(model)}].peakOffpeak.${part} must be a full price set`);
	}
	if (!Array.isArray(regime.peakWindowsUtc) || regime.peakWindowsUtc.length === 0) throw new Error(`dsh-usage-report: prices[${JSON.stringify(model)}].peakOffpeak.peakWindowsUtc must be a non-empty array of [start, end) minute-of-day windows`);
}
/** Merge user price overrides over the shipped DeepSeek table. */
function mergePrices(overrides) {
	if (overrides === void 0) return DEEPSEEK_PRICES;
	const merged = { ...DEEPSEEK_PRICES };
	for (const [model, raw] of Object.entries(overrides)) {
		assertPriceShape(model, raw);
		merged[model] = raw;
	}
	return merged;
}
const usageProps = {
	type: "object",
	additionalProperties: false,
	properties: {
		uncachedInputTokens: {
			type: "integer",
			required: true
		},
		cacheReadTokens: {
			type: "integer",
			required: true
		},
		cacheWriteTokens: {
			type: "integer",
			required: true
		},
		outputTokens: {
			type: "integer",
			required: true
		},
		requests: {
			type: "integer",
			required: true
		},
		cost: {
			type: "number",
			required: true
		}
	}
};
/**
* Register the projection unit, the `/usage` command, and the `usage_report`
* tool on the calling context.
* @param ctx - registrant context carrying the tool and command registries.
* @param config - validated plugin configuration.
*/
function apply(ctx, config) {
	const prices = mergePrices(config.prices);
	const mode = config.pricing === "peak-offpeak" ? "peak-offpeak" : "flat";
	const costDecimals = config.costDecimals ?? 6;
	const foldOptions = {
		prices,
		mode,
		...config.defaultModel === void 0 ? {} : { defaultModel: config.defaultModel }
	};
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		projectionCtx.sessionProjections.register(usageReportProjectionWith(foldOptions));
	});
	const readReport = (session) => {
		const registry = ctx.get("sessionProjections");
		if (registry === void 0) return emptyUsageReport();
		return registry.snapshot(session).values.usageReport ?? emptyUsageReport();
	};
	ctx.commands.register({
		name: "usage",
		description: "Show this session's token usage and estimated cost",
		handler: async (invocation) => {
			if (invocation.rawInput.trim().length > 0) return {
				kind: "error",
				text: "Usage: /usage (no arguments)"
			};
			return {
				kind: "success",
				text: formatReport(readReport(invocation.agent.session), prices, costDecimals, mode)
			};
		}
	});
	ctx.tools.register(defineTool({
		name: "usage_report",
		description: "Report the current session's provider-reported token usage and estimated cost. Token buckets are uncached input, cache-read input, cache-write input, and output; cost is estimated from the configured price table and is not a billing record.",
		parameters: { detail: {
			type: "string",
			enum: ["summary", "per-model"],
			description: "Which detail to render in the text projection (the canonical value always carries both). Default: per-model."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					totals: {
						...usageProps,
						required: true
					},
					models: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								model: {
									type: "string",
									required: true
								},
								usage: {
									...usageProps,
									required: true
								}
							}
						}
					}
				}
			},
			render: (_args, value) => {
				const byModel = {};
				for (const row of value.models) byModel[row.model] = row.usage;
				return [{
					type: "text",
					text: formatReport({
						totals: value.totals,
						models: byModel
					}, prices, costDecimals, mode)
				}];
			}
		},
		async execute(_args, exec) {
			if (exec.agent === void 0) throw new Error("usage_report requires an owning agent session");
			const value = readReport(exec.agent.session);
			return {
				totals: value.totals,
				models: Object.entries(value.models).map(([model, usage]) => ({
					model,
					usage
				}))
			};
		}
	}));
}
//#endregion
export { Config, apply, inject, name };
