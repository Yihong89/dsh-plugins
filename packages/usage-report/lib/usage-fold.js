/**
 * The `usageReport` projection unit: a pure fold over session events that
 * attributes provider-reported usage to the model named by the nearest
 * preceding `request/header` route, mirroring token-meter's
 * last-sample-replacing semantics per (turn, step), and prices each sample
 * with the configured price table.
 *
 * @module dsh-usage-report/usage-fold
 */
import { z } from 'zod';
import { costOf, priceFor } from './pricing.js';
const zeroUsage = () => ({
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    requests: 0,
    cost: 0,
});
/** The provider-reported usage of one event, if any (mirrors token-meter). */
function usageOf(event) {
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
        const usage = event.data.chunk.usage;
        return {
            turn: event.data.turn,
            step: event.data.step,
            timeMs: event.time,
            buckets: {
                uncachedInputTokens: usage.inputTokens,
                cacheReadTokens: usage.cacheReadTokens ?? 0,
                cacheWriteTokens: usage.cacheWriteTokens ?? 0,
                outputTokens: usage.outputTokens,
            },
        };
    }
    if (event.type === 'assistant/message' && event.data.usage !== undefined) {
        const usage = event.data.usage;
        return {
            turn: event.data.turn,
            step: event.data.step,
            timeMs: event.time,
            buckets: {
                uncachedInputTokens: usage.inputTokens,
                cacheReadTokens: usage.cacheReadTokens ?? 0,
                cacheWriteTokens: usage.cacheWriteTokens ?? 0,
                outputTokens: usage.outputTokens,
            },
        };
    }
    return undefined;
}
const bucketKeys = [
    'uncachedInputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'outputTokens',
];
/** Add `next` bucket values to `base`, returning a new object. */
function addBuckets(base, next, requests, cost) {
    const result = { ...base, requests, cost };
    for (const key of bucketKeys)
        result[key] = base[key] + next[key];
    return result;
}
/** Subtract `removed` bucket values from `base`, returning a new object. */
function subtractBuckets(base, removed, requests, cost) {
    const result = { ...base, requests, cost };
    for (const key of bucketKeys)
        result[key] = base[key] - removed[key];
    return result;
}
/**
 * Fold one event onto the usage-report state. Returns the same reference when
 * the event is not the unit's (the projection registry's zero-work contract).
 */
export function applyUsage(state, event, options) {
    if (event.type === 'request/header') {
        const config = event.data.header.config;
        if (config.provider === state.route?.provider && config.model === state.route?.model)
            return state;
        return { ...state, route: { provider: config.provider, model: config.model } };
    }
    const sample = usageOf(event);
    if (sample === undefined)
        return state;
    const model = state.route?.model ?? options.defaultModel ?? 'unknown';
    const price = options.prices[model];
    const cost = price === undefined ? 0 : costOf(priceFor(price, options.mode, sample.timeMs), sample.buckets);
    const previous = state.last !== null && state.last.turn === sample.turn && state.last.step === sample.step
        ? state.last
        : undefined;
    if (previous !== undefined) {
        // Replacing this step's earlier sample (usage chunk superseded by the
        // assembled message): subtract the old sample, add the new one.
        const models = { ...state.models };
        const current = models[previous.model] ?? zeroUsage();
        models[previous.model] = subtractBuckets(current, previous.buckets, current.requests - 1, current.cost - previous.cost);
        const target = models[model] ?? zeroUsage();
        models[model] = addBuckets(target, sample.buckets, target.requests + 1, target.cost + cost);
        return { ...state, models, last: { turn: sample.turn, step: sample.step, model, buckets: sample.buckets, cost } };
    }
    // A brand-new (turn, step): one more request for its model.
    const models = { ...state.models };
    const target = models[model] ?? zeroUsage();
    models[model] = addBuckets(target, sample.buckets, target.requests + 1, target.cost + cost);
    return { ...state, models, last: { turn: sample.turn, step: sample.step, model, buckets: sample.buckets, cost } };
}
/** Derive the wire payload: per-model usage plus the totals across models. */
export function viewUsage(state) {
    const totals = zeroUsage();
    const models = {};
    for (const [model, usage] of Object.entries(state.models)) {
        if (usage.requests === 0 && usage.cost === 0 && usage.uncachedInputTokens === 0
            && usage.cacheReadTokens === 0 && usage.cacheWriteTokens === 0 && usage.outputTokens === 0)
            continue;
        models[model] = usage;
        totals.uncachedInputTokens += usage.uncachedInputTokens;
        totals.cacheReadTokens += usage.cacheReadTokens;
        totals.cacheWriteTokens += usage.cacheWriteTokens;
        totals.outputTokens += usage.outputTokens;
        totals.requests += usage.requests;
        totals.cost += usage.cost;
    }
    return { totals, models };
}
const usageSchema = z.object({
    uncachedInputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    requests: z.number().int().nonnegative(),
    cost: z.number().nonnegative(),
}).strict();
/** Wire schema of the `usageReport` projection value. */
export const usageReportSchema = z.object({
    totals: usageSchema,
    models: z.record(z.string(), usageSchema),
}).strict();
/**
 * Bind the fold to a resolved price table. Returns a fresh definition whose
 * `apply` closes over the options.
 */
export function usageReportProjectionWith(options) {
    return {
        key: 'usageReport',
        schema: usageReportSchema,
        init: () => ({ route: null, models: {}, last: null }),
        apply: (state, event) => applyUsage(state, event, options),
        view: viewUsage,
        stateVersion: 1,
    };
}
/** An empty report, for sessions with no usage yet. */
export function emptyUsageReport() {
    return { totals: zeroUsage(), models: {} };
}
