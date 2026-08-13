/**
 * Human-readable rendering of a usage report for the `/usage` command and the
 * `usage_report` tool's model-facing text.
 *
 * @module dsh-usage-report/format
 */
import type { UsageReportValue } from './types.js';
import type { PriceTable } from './pricing.js';
/** How many decimals to render cost with (DeepSeek bills per 1M tokens, so USD costs are small). */
export declare const DEFAULT_COST_DECIMALS = 6;
/** Render one report as a fixed-width text table. */
export declare function formatReport(value: UsageReportValue, prices: PriceTable, costDecimals?: number, modeLabel?: string): string;
