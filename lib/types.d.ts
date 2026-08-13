/**
 * Pure types of the usage-report domain: the ONE home of the `usageReport`
 * projection-key declaration plus its payload types, free of host-side value
 * imports (cordis, zod, dsh-tools). Type-only imports keep this module safe
 * for any consumer.
 *
 * @module dsh-usage-report/types
 */
import type { UsageBuckets } from './pricing.js';
/** One model's durable usage + estimated cost within one session. */
export interface ModelUsage extends UsageBuckets {
    /** Provider requests attributed to this model. */
    requests: number;
    /** Estimated USD cost under the configured price table (0 when unpriced). */
    cost: number;
}
/**
 * The `usageReport` projection value: per-model usage plus the totals across
 * models. `totals` is the sum of every model entry, so unpriced models still
 * contribute their token counts.
 */
export interface UsageReportValue {
    totals: ModelUsage;
    models: Record<string, ModelUsage>;
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /**
         * The session's provider-reported token usage and estimated cost,
         * attributed per model. Folds `request/header` routes and `assistant/chunk`
         * (usage) / `assistant/message` usage samples with token-meter's
         * last-sample-replacing semantics per (turn, step).
         */
        usageReport: UsageReportValue;
    }
}
