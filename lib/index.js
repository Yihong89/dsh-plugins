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
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { DEEPSEEK_PRICES, } from './pricing.js';
import { usageReportProjectionWith, emptyUsageReport } from './usage-fold.js';
import { formatReport, DEFAULT_COST_DECIMALS } from './format.js';
export const name = 'dsh-usage-report';
export const inject = ['tools', 'commands'];
export const Config = z.object({
    pricing: z.union([z.const('flat'), z.const('peak-offpeak')]).default('flat'),
    prices: z.dict(z.any()),
    defaultModel: z.string(),
    costDecimals: z.number(),
});
/** Fail loudly on a malformed `prices` entry rather than silently underpricing. */
function assertPriceShape(model, raw) {
    const pricing = raw;
    const flat = pricing?.flat;
    const numbers = (value) => typeof value === 'number' && Number.isFinite(value);
    if (flat === undefined
        || !numbers(flat.inputPerMillion) || flat.inputPerMillion < 0
        || !numbers(flat.cacheReadPerMillion) || flat.cacheReadPerMillion < 0
        || !numbers(flat.outputPerMillion) || flat.outputPerMillion < 0) {
        throw new Error(`dsh-usage-report: prices[${JSON.stringify(model)}] must be { flat: { inputPerMillion, `
            + 'cacheReadPerMillion, outputPerMillion } } with non-negative numbers');
    }
    const regime = pricing?.peakOffpeak;
    if (regime === undefined)
        return;
    for (const part of ['peak', 'offPeak']) {
        const price = regime[part];
        if (price === undefined
            || !numbers(price.inputPerMillion) || !numbers(price.cacheReadPerMillion) || !numbers(price.outputPerMillion)) {
            throw new Error(`dsh-usage-report: prices[${JSON.stringify(model)}].peakOffpeak.${part} must be a full price set`);
        }
    }
    if (!Array.isArray(regime.peakWindowsUtc) || regime.peakWindowsUtc.length === 0) {
        throw new Error(`dsh-usage-report: prices[${JSON.stringify(model)}].peakOffpeak.peakWindowsUtc must be a non-empty array of [start, end) minute-of-day windows`);
    }
}
/** Merge user price overrides over the shipped DeepSeek table. */
function mergePrices(overrides) {
    if (overrides === undefined)
        return DEEPSEEK_PRICES;
    const merged = { ...DEEPSEEK_PRICES };
    for (const [model, raw] of Object.entries(overrides)) {
        assertPriceShape(model, raw);
        merged[model] = raw;
    }
    return merged;
}
const usageProps = {
    type: 'object',
    additionalProperties: false,
    properties: {
        uncachedInputTokens: { type: 'integer', required: true },
        cacheReadTokens: { type: 'integer', required: true },
        cacheWriteTokens: { type: 'integer', required: true },
        outputTokens: { type: 'integer', required: true },
        requests: { type: 'integer', required: true },
        cost: { type: 'number', required: true },
    },
};
/**
 * Register the projection unit, the `/usage` command, and the `usage_report`
 * tool on the calling context.
 * @param ctx - registrant context carrying the tool and command registries.
 * @param config - validated plugin configuration.
 */
export function apply(ctx, config) {
    const prices = mergePrices(config.prices);
    const mode = config.pricing === 'peak-offpeak' ? 'peak-offpeak' : 'flat';
    const costDecimals = config.costDecimals ?? DEFAULT_COST_DECIMALS;
    const foldOptions = {
        prices,
        mode,
        ...(config.defaultModel === undefined ? {} : { defaultModel: config.defaultModel }),
    };
    // The projection unit registers only when the session-projection seam is
    // composed; the command and tool read the report through ctx.get and work
    // without it (empty report until the seam exists).
    ctx.inject(['sessionProjections'], (projectionCtx) => {
        projectionCtx.sessionProjections.register(usageReportProjectionWith(foldOptions));
    });
    const readReport = (session) => {
        const registry = ctx.get('sessionProjections');
        if (registry === undefined)
            return emptyUsageReport();
        return registry.snapshot(session).values.usageReport ?? emptyUsageReport();
    };
    ctx.commands.register({
        name: 'usage',
        description: 'Show this session\'s token usage and estimated cost',
        handler: async (invocation) => {
            if (invocation.rawInput.trim().length > 0) {
                return { kind: 'error', text: 'Usage: /usage (no arguments)' };
            }
            const value = readReport(invocation.agent.session);
            return { kind: 'success', text: formatReport(value, prices, costDecimals, mode) };
        },
    });
    ctx.tools.register(defineTool({
        name: 'usage_report',
        description: 'Report the current session\'s provider-reported token usage and estimated cost. '
            + 'Token buckets are uncached input, cache-read input, cache-write input, and output; '
            + 'cost is estimated from the configured price table and is not a billing record.',
        parameters: {
            detail: {
                type: 'string',
                enum: ['summary', 'per-model'],
                description: 'Which detail to render in the text projection (the canonical value always carries both). Default: per-model.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    totals: { ...usageProps, required: true },
                    models: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                model: { type: 'string', required: true },
                                usage: { ...usageProps, required: true },
                            },
                        },
                    },
                },
            },
            render: (_args, value) => {
                const byModel = {};
                for (const row of value.models)
                    byModel[row.model] = row.usage;
                return [{
                        type: 'text',
                        text: formatReport({ totals: value.totals, models: byModel }, prices, costDecimals, mode),
                    }];
            },
        },
        async execute(_args, exec) {
            if (exec.agent === undefined) {
                throw new Error('usage_report requires an owning agent session');
            }
            const value = readReport(exec.agent.session);
            return {
                totals: value.totals,
                models: Object.entries(value.models).map(([model, usage]) => ({ model, usage })),
            };
        },
    }));
}
