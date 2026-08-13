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
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { ModelUsage, UsageReportValue } from './types.js';
import { type PricingMode, type PriceTable, type UsageBuckets } from './pricing.js';
/** One usage sample's durable bookkeeping (the (turn, step) replace slot). */
interface SampleRecord {
    turn: number;
    step: number;
    model: string;
    buckets: UsageBuckets;
    cost: number;
}
/**
 * The unit's internal fold state. Plain JSON by the projection contract: the
 * route is the last `request/header` snapshot, `models` accumulate per-model
 * usage, and `last` is the newest sample slot for replace-per-(turn, step).
 */
export interface UsageReportState {
    route: {
        provider: string;
        model: string;
    } | null;
    models: Record<string, ModelUsage>;
    last: SampleRecord | null;
}
/** Configuration the fold needs; fixed at registration from the plugin config. */
export interface FoldOptions {
    prices: PriceTable;
    mode: PricingMode;
    /** Model attributed to a usage sample with no preceding `request/header`; defaults to `'unknown'`. */
    defaultModel?: string;
}
/**
 * Fold one event onto the usage-report state. Returns the same reference when
 * the event is not the unit's (the projection registry's zero-work contract).
 */
export declare function applyUsage(state: UsageReportState, event: SessionEvent, options: FoldOptions): UsageReportState;
/** Derive the wire payload: per-model usage plus the totals across models. */
export declare function viewUsage(state: UsageReportState): UsageReportValue;
/** Wire schema of the `usageReport` projection value. */
export declare const usageReportSchema: z.ZodObject<{
    totals: z.ZodObject<{
        uncachedInputTokens: z.ZodNumber;
        cacheReadTokens: z.ZodNumber;
        cacheWriteTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        requests: z.ZodNumber;
        cost: z.ZodNumber;
    }, z.core.$strict>;
    models: z.ZodRecord<z.ZodString, z.ZodObject<{
        uncachedInputTokens: z.ZodNumber;
        cacheReadTokens: z.ZodNumber;
        cacheWriteTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        requests: z.ZodNumber;
        cost: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
/**
 * Bind the fold to a resolved price table. Returns a fresh definition whose
 * `apply` closes over the options.
 */
export declare function usageReportProjectionWith(options: FoldOptions): ProjectionDefinition<'usageReport', UsageReportState>;
/** An empty report, for sessions with no usage yet. */
export declare function emptyUsageReport(): UsageReportValue;
export {};
