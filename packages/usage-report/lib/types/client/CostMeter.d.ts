/**
 * Live session-cost readout for the web composer dock. Reads the host's
 * `usageReport` session projection through the framework's `useProjection`
 * standard-kit seat (session-scope slots receive it automatically) and renders
 * the estimated cost, color-coded by magnitude.
 * @module dsh-usage-report/client/CostMeter
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Props of the dock entry — the session standard kit already carries `useProjection`. */
export type CostMeterProps = PropsRuntime<'conversation.composer.dock'>;
/**
 * Format a USD cost to a compact string, e.g. `$1.25`.
 * @param cost - the estimated cost (USD).
 * @param decimals - decimal places for display (default 2).
 * @returns the `$`-prefixed fixed-point string.
 */
export declare function formatCost(cost: number, decimals?: number): string;
/**
 * Render the current session's estimated cost in USD and CNY, color-coded by
 * magnitude (banded on the USD figure). Renders nothing until the projection
 * has a value (no session / no usage yet).
 * @param props - dock-slot props; only `useProjection` is consumed.
 * @returns the cost readout, or `null` when no projection value exists.
 */
export declare function CostMeter({ useProjection }: CostMeterProps): JSX.Element | null;
