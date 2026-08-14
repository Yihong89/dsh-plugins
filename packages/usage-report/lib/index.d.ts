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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type PricingMode } from './pricing.js';
import type { ModelUsage } from './types.js';
export declare const name = "dsh-usage-report";
export declare const inject: string[];
/** Plugin configuration, settable from the cordis.yml entry's `config:` block. */
export interface Config {
    /**
     * Which price regime the estimated cost uses: `'flat'` (single rates) or
     * `'peak-offpeak'` (rates vary by UTC hour, DeepSeek's regime effective
     * 2026-08-16). Default `'flat'`.
     */
    pricing: PricingMode;
    /**
     * Per-model price overrides, merged over the shipped DeepSeek table. A
     * model with no entry is unpriced (its tokens still count, cost 0). Shape
     * per model: `{ flat: {inputPerMillion, cacheReadPerMillion,
     * outputPerMillion}, peakOffpeak?: {peak: {...}, offPeak: {...},
     * peakWindowsUtc: [[startMinutes, endMinutes], ...]} }`.
     */
    prices?: Record<string, unknown>;
    /** Model attributed to usage with no preceding `request/header` (default `'unknown'`). */
    defaultModel?: string;
    /** Decimal places for USD cost in text output (default 6). */
    costDecimals?: number;
    /** URL of the DeepSeek pricing page used by `/usage check-prices` (default api-docs.deepseek.com). */
    priceCheckUrl?: string;
}
export declare const Config: z<Config>;
/** The tool's canonical value: totals plus one row per model (schema-friendly array). */
export interface UsageReportToolValue {
    totals: ModelUsage;
    models: {
        model: string;
        usage: ModelUsage;
    }[];
}
/**
 * Register the projection unit, the `/usage` command, and the `usage_report`
 * tool on the calling context.
 * @param ctx - registrant context carrying the tool and command registries.
 * @param config - validated plugin configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
